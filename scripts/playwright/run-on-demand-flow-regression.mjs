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
 for (const catalogFailure of [false,true]) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const feedback=[],events=[],errors=[]; let failedCatalogRequests=0;
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname==='test-streams.mux.dev'){
    const file=url.pathname.endsWith('.m3u8')?'index.m3u8':basename(url.pathname);
    await route.fulfill({body:readFileSync(mediaDir+'/'+file),contentType:file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',headers:{'access-control-allow-origin':'*'}});return;
   }
   if(url.pathname.includes('player_api.php')) {
    const action=url.searchParams.get('action');
    if(action?.startsWith('get_live_')){failedCatalogRequests++;await route.fulfill({status:502,body:'fixture upstream failure'});return;}
    const response=action==='get_vod_info'?{info:{name:'Film (1997)',plot:'Test',duration:'01:30:00'},movie_data:{stream_id:1,container_extension:'m3u8',direct_source:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'}}:{user_info:{auth:1,status:'Active',username:'fixture',exp_date:null,allowed_output_formats:['m3u8']},server_info:{timezone:'Europe/Belgrade'}};
    await route.fulfill({json:response});return;
   }
   if(url.pathname==='/player-analytics/ingest'){
    const batch=request.postDataJSON();feedback.push(...batch.feedback??[]);events.push(...batch.events??[]);await route.fulfill({status:200,json:{ok:true}});return;
   }
   if(url.pathname.startsWith('/player-analytics')||url.pathname==='/observe'){await route.fulfill({status:204});return;}
   if(url.origin===new URL(baseUrl).origin){await route.continue();return;}
   await route.abort();
  });
  await context.addInitScript(({catalogFailure})=>{sessionStorage.setItem('lumen:player-analytics:v1',JSON.stringify({subject:'a'.repeat(64),sessionId:'00000000-0000-4000-8000-000000000001',ingestUrl:'/player-analytics/ingest',replayUrl:'/player-analytics/replay'}));sessionStorage.setItem('lumen:player-analytics-metrics:v1',JSON.stringify({sessionId:'00000000-0000-4000-8000-000000000001',startedAtMs:Date.now()-1000,currentChannel:{id:'5',name:'PRETHODNI TV KANAL'}}));const k='lumen-web:v1:xtream_credentials';localStorage.setItem(k,JSON.stringify(catalogFailure?{server:'https://fixture.invalid',username:'fixture',password:'fixture'}:{server:'https://your-server.com',username:'demo',password:'demo'}));localStorage.setItem('lumen-web:v1:__keys__',JSON.stringify([k]));},{catalogFailure});
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseUrl+'/'+(catalogFailure?'vod/1':'series/1'));
  const initialPlay=page.getByRole('button',{name:catalogFailure?'Gledaj film':'Gledaj epizodu',exact:true}).first();await initialPlay.waitFor();
  const initialRect=await initialPlay.boundingBox();assert(initialRect.y+initialRect.height<844,'primary play action is below first viewport');
  await page.screenshot({path:`${outputDir}/detail-${catalogFailure?'vod':'series'}.png`});
  await initialPlay.click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.5,null,{timeout:20000});
  const controls=page.getByTestId('on-demand-controls');
  if(catalogFailure){
   await page.waitForTimeout(6000);
   assert(failedCatalogRequests>0,'catalog failure was not exercised');
   assert(await controls.isVisible());await page.waitForFunction(()=>document.querySelector('video')?.currentTime>5,null,{timeout:15000});
   results.push({catalogFailure:'VOD continues despite live API 502',failedCatalogRequests});
  } else {
   // Seek through the actual control, pause, leave, and resume via the detail page.
   const timeline=controls.getByRole('slider',{name:'Pozicija reprodukcije'});await timeline.fill('27');
   await page.waitForFunction(()=>document.querySelector('video')?.currentTime>=26,null,{timeout:10000});
   await controls.getByRole('button',{name:'Pauza',exact:true}).click();
   const pausedAt=await page.locator('video').evaluate(v=>v.currentTime);
   await controls.getByRole('button',{name:'Nazad na seriju',exact:true}).click();
   await page.reload();
   await page.getByRole('button',{name:/Nastavi od/}).first().click();
   await page.waitForFunction(t=>{const v=document.querySelector('video');return v&&v.currentTime>=t-1&&!v.paused;},pausedAt,{timeout:15000});
   await controls.getByRole('button',{name:'Nazad na seriju',exact:true}).click();
   await page.getByRole('button',{name:'Od početka',exact:true}).first().click();
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>0&&v.currentTime<5;},null,{timeout:15000});
   await controls.getByRole('button',{name:'Sledeća epizoda',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('h2')?.textContent.includes('S1E2'));
   await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2,null,{timeout:15000});
   assert(await controls.getByRole('button',{name:'Sledeća epizoda',exact:true}).isDisabled());
   await controls.getByRole('button',{name:'Prethodna epizoda',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('h2')?.textContent.includes('S1E1'));
   await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2,null,{timeout:15000});
   await timeline.fill('89');
   await page.waitForFunction(()=>document.querySelector('h2')?.textContent.includes('S1E2'),null,{timeout:15000});
   await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2,null,{timeout:15000});
   results.push({resume:true,restart:true,next:true,previous:true,autoAdvance:true,pausedAt});
  }
  await page.getByRole('button',{name:/Problem\?/}).click();
  assert(await page.getByRole('radio',{name:'Film ili epizoda ne radi',exact:true}).getAttribute('aria-checked')==='true');
  await page.getByRole('radio',{name:'Nema slike',exact:true}).click();
  await page.getByLabel('Opiši problem ili predlog').fill('Lokalna provera forme');
  await page.getByRole('button',{name:'Pošalji prijavu',exact:true}).click();
  await page.getByText('Hvala — prijava je poslata.').waitFor();
  assert.equal(feedback.length,1);assert.equal(feedback[0].category,'no_video');assert(!feedback[0].channelId&&!feedback[0].channelName,'stale TV channel leaked into feedback');
  assert.equal(feedback[0].diagnostics.content.kind,catalogFailure?'vod':'series');
  if(!catalogFailure)assert.equal(feedback[0].diagnostics.content.episodeId,'1-s1e2');
  assert.deepEqual(errors,[]);
  results.push({feedback:true,content:feedback[0].diagnostics.content,primaryActionY:initialRect.y});
  await context.close();
 }
 console.log(JSON.stringify(results,null,2));
} finally {await browser.close();writeFileSync(`${outputDir}/flow-results.json`,JSON.stringify(results,null,2));}
