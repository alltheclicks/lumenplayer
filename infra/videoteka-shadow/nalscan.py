import sys

# Usage:
#   python3 nalscan.py FILE            -> human report of NAL offsets + verdict
#   python3 nalscan.py --is-clean -    -> read stdin, exit 0 if clean, 1 if dead zone
#
# "Clean" = the first SPS (NAL type 7) appears before the first coded slice
# (type 1 non-IDR or type 5 IDR). Dead zone = a slice precedes any SPS, so the
# GOP head references parameter sets that have not arrived yet.

def scan(data):
    n = len(data)
    first = {}
    count = {}
    pos = 0
    while True:
        j = data.find(b"\x00\x00\x01", pos)
        if j < 0:
            break
        if j + 3 < n:
            t = data[j + 3] & 0x1f
            count[t] = count.get(t, 0) + 1
            if t not in first:
                first[t] = j
        pos = j + 3
    return first, count


def is_clean(first):
    sps = first.get(7)
    slice_offsets = [o for o in (first.get(1), first.get(5)) if o is not None]
    if not slice_offsets:
        # No coded slice seen in the window — treat as clean (nothing to strand).
        return True
    first_slice = min(slice_offsets)
    return sps is not None and sps < first_slice


args = sys.argv[1:]
if args and args[0] == "--is-clean":
    src = args[1] if len(args) > 1 else "-"
    data = sys.stdin.buffer.read() if src == "-" else open(src, "rb").read()
    sys.exit(0 if is_clean(scan(data)[0]) else 1)

# Human report mode
path = args[0]
data = open(path, "rb").read()
first, count = scan(data)
nal_names = {7: "SPS", 8: "PPS", 5: "IDR", 1: "non-IDR", 9: "AUD", 6: "SEI"}
print("First byte-offset of each NAL type:")
for t in sorted(first):
    print("  type %2d %-8s @ offset %d" % (t, nal_names.get(t, "?"), first[t]))
print("Counts:", {nal_names.get(k, k): v for k, v in sorted(count.items())})
sps = first.get(7); pps = first.get(8); idr = first.get(5); nonidr = first.get(1)
print()
print("SPS@%s PPS@%s IDR@%s first-slice(non-IDR)@%s" % (sps, pps, idr, nonidr))
print("VERDICT: %s" % ("CLEAN" if is_clean(first) else "DEAD ZONE present"))
