import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
const baseUrl = process.env.LUMEN_QA_BASE_URL ?? 'http://127.0.0.1:5188';
const outputDir = process.env.LUMEN_QA_OUTPUT_DIR ?? 'output/playwright/on-demand-regression';
const mediaDir = process.env.LUMEN_QA_MEDIA_DIR;
if (!mediaDir) throw new Error('Set LUMEN_QA_MEDIA_DIR to the generated HLS fixture directory.');
if (!['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname)) throw new Error('This fixture test only runs against a local build.');
mkdirSync(outputDir, { recursive: true });
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for (const [width,height] of [[360,740],[390,844],[430,932],[844,390],[768,1024],[1440,900]]) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024,isMobile:width<1024});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='test-streams.mux.dev') {
    const file=url.pathname.endsWith('.m3u8')?'index.m3u8':basename(url.pathname);
    await route.fulfill({body:readFileSync(mediaDir+'/'+file),contentType:file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',headers:{'access-control-allow-origin':'*'}});return;
   }
   if(url.pathname.startsWith('/player-analytics')||url.pathname==='/observe'){await route.fulfill({status:204});return;}
   if(url.origin===new URL(baseUrl).origin){await route.continue();return;}
   await route.abort();
  });
  await context.addInitScript(()=>{const k='lumen-web:v1:xtream_credentials';localStorage.setItem(k,JSON.stringify({server:'https://your-server.com',username:'demo',password:'demo'}));localStorage.setItem('lumen-web:v1:__keys__',JSON.stringify([k]));});
  const page=await context.newPage(); const errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseUrl+'/series/1');
  await page.getByRole('button',{name:'Gledaj epizodu',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.5, null, {timeout:20000});
  const metrics=await page.evaluate(()=>({video:document.querySelector('video').getBoundingClientRect().toJSON(),controls:document.querySelector('[data-testid="on-demand-controls"]').getBoundingClientRect().toJSON(),vw:innerWidth,doc:document.documentElement.scrollWidth}));
  assert(metrics.controls.top>=metrics.video.bottom-1,JSON.stringify(metrics)); assert(metrics.doc<=width+1,JSON.stringify(metrics));
  assert(metrics.video.height>120,'video too short');
  await page.screenshot({path:`${outputDir}/series-${width}x${height}.png`});
  if(width===390||width===1440){
   await page.getByRole('button',{name:'Ceo ekran',exact:true}).click();
   await page.waitForFunction(()=>Boolean(document.fullscreenElement));
   // Startup/rebuffering deliberately keeps controls visible; allow it to settle first.
   await page.getByTestId('on-demand-controls').waitFor({state:'hidden',timeout:15000});
   await page.getByRole('button',{name:'Prikaži komande reprodukcije',exact:true}).click();
   await page.getByTestId('on-demand-controls').waitFor({state:'visible'});
   await page.getByRole('button',{name:'Pauza',exact:true}).click();
   await page.waitForTimeout(3300);
   assert(await page.getByTestId('on-demand-controls').isVisible(),'paused controls must remain visible');
   await page.screenshot({path:`${outputDir}/fullscreen-${width}.png`});
   await page.getByRole('button',{name:'Smanji ekran',exact:true}).click();
   await page.waitForFunction(()=>!document.fullscreenElement);
  }
  await page.getByTestId('on-demand-controls').getByRole('button',{name:'TV uživo',exact:true}).click();
  await page.getByRole('button',{name:/Svi kanali/}).first().waitFor({state:width<1024?'hidden':'visible'});
  assert.equal(await page.getByTestId('on-demand-controls').count(),0,'live must not have on-demand controls');
  const unnamed = await page.locator('button:visible').evaluateAll(buttons => buttons
    .filter(button => !button.textContent.trim() && !button.getAttribute('aria-label') && !button.title)
    .map(button => button.outerHTML.slice(0, 180)));
  assert.deepEqual(unnamed, [], 'visible controls must have accessible names');
  assert.deepEqual(errors,[]);
  results.push({width,height,...metrics,status:'pass'});console.log(JSON.stringify(results.at(-1)));
  await context.close();
 }
} finally {await browser.close();writeFileSync(`${outputDir}/layout-results.json`,JSON.stringify(results,null,2));}
