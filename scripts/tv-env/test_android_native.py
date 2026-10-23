"""Offline native SDK installer regression tests; never touch the real SDK."""
import importlib.machinery
import importlib.util
import json
import os
import pathlib
import stat
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('android_native', str(pathlib.Path(__file__).with_name('android-native')))
spec = importlib.util.spec_from_loader(loader.name, loader)
native = importlib.util.module_from_spec(spec)
loader.exec_module(native)


class NativeSdkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.here = self.root / 'scripts'
        self.here.mkdir()
        self.item = dict(file='cmake.zip', url='https://invalid.example/no-network',
                         path='cmake/3.22.1', revision='3.22.1')
        cache = self.root / 'downloads'
        cache.mkdir()
        self.archive = cache / self.item['file']
        with zipfile.ZipFile(self.archive, 'w') as z:
            for path, content in [('source.properties', 'Pkg.Revision = 3.22.1\n'),
                                  ('bin/cmake', '#!/bin/sh\necho "cmake version 3.22.1"\n'),
                                  ('bin/ninja', '#!/bin/sh\necho "1.10.2"\n')]:
                entry = zipfile.ZipInfo(path)
                entry.external_attr = (stat.S_IFREG | 0o755) << 16
                z.writestr(entry, content)
        self.item.update(size=self.archive.stat().st_size,
                         vendor_sha1=native.hashlib.sha1(self.archive.read_bytes()).hexdigest())
        (self.here / 'downloads.json').write_text(json.dumps({'android_native': [self.item]}))
        for context in [patch.object(native, 'HERE', self.here),
                        patch.dict(os.environ, KLARO_TV_SDK_ROOT=str(self.root)),
                        patch.object(native.os, 'geteuid', return_value=1000)]:
            context.start()
            self.addCleanup(context.stop)

    def license(self, root):
        self.assertEqual(root, self.root)
        p = self.root / 'android/licenses/android-sdk-license'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('fixture accepted license\n')

    def invoke(self, mode):
        with patch.object(sys, 'argv', ['android-native', mode]):
            native.main()

    def test_install_cached_then_reuse_without_any_mutation(self):
        with patch.object(native, 'accept_licenses', side_effect=self.license) as run:
            self.invoke('--accept-licenses')
            self.assertEqual(run.call_count, 1)
        self.archive.unlink()  # Reuse must not need a cached or downloaded archive.
        with patch.object(native, 'accept_licenses', side_effect=AssertionError('must reuse')):
            self.invoke('--accept-licenses')
            self.invoke('--check')
        self.assertFalse((self.root / '.android-native.lock').exists())

    def test_missing_check_is_read_only(self):
        with self.assertRaisesRegex(RuntimeError, 'Missing native packages'):
            self.invoke('--check')
        self.assertFalse((self.root / 'android').exists())

    def test_corrupt_cache_rejected_before_extraction(self):
        self.archive.write_bytes(b'corrupt')
        with patch.object(native, 'accept_licenses', side_effect=self.license):
            with self.assertRaisesRegex(RuntimeError, 'SHA-1/size mismatch'):
                self.invoke('--accept-licenses')
        self.assertFalse((self.root / 'android/cmake').exists())
        self.assertFalse((self.root / '.android-native.lock').exists())

    def test_installed_drift_refuses_replacement(self):
        target = self.root / 'android' / self.item['path']
        target.mkdir(parents=True)
        (target / 'source.properties').write_text('Pkg.Revision = 0\n')
        with self.assertRaisesRegex(RuntimeError, 'refusing replacement'):
            self.invoke('--accept-licenses')
        self.assertEqual((target / 'source.properties').read_text(), 'Pkg.Revision = 0\n')

    def test_existing_lock_is_preserved(self):
        lock = self.root / '.android-native.lock'
        lock.mkdir()
        with self.assertRaises(FileExistsError):
            self.invoke('--accept-licenses')
        self.assertTrue(lock.exists())

    def test_space_guard(self):
        with patch.object(native, 'accept_licenses', side_effect=self.license), patch.object(
                native.shutil, 'disk_usage', return_value=native.shutil._ntuple_diskusage(1, 1, 0)):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient free space'):
                self.invoke('--accept-licenses')
        self.assertFalse((self.root / 'android/cmake').exists())

    def test_refused_license(self):
        with patch.object(native, 'accept_licenses'):
            with self.assertRaisesRegex(RuntimeError, 'not accepted'):
                self.invoke('--accept-licenses')

    def test_archive_paths_and_symlinks(self):
        for name, content, mode in [('../escape', 'bad', stat.S_IFREG),
                                    ('link', '../../escape', stat.S_IFLNK)]:
            with self.subTest(name=name):
                with zipfile.ZipFile(self.archive, 'w') as z:
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = (mode | 0o755) << 16
                    z.writestr(entry, content)
                with tempfile.TemporaryDirectory(dir=self.root) as stage:
                    with self.assertRaisesRegex(RuntimeError, 'Unsafe archive'):
                        native.extract_package(self.archive, pathlib.Path(stage), self.item)


if __name__ == '__main__':
    unittest.main()
