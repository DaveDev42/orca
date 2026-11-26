// Test pages served by the spike's own loopback server (http://localhost:<port>/p/<name>).
// Each reports one JSON message to native through window.webkit.messageHandlers.spike.

export const HLS_URL =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8'
export const WS_URLS = ['wss://echo.websocket.events', 'wss://ws.postman-echo.com/raw']

const PRELUDE = `<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px -apple-system,sans-serif;margin:12px;word-break:break-all}</style>
<script>function post(o){try{window.webkit.messageHandlers.spike.postMessage(JSON.stringify(o))}catch(e){}}</script>`

function page(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title>${PRELUDE}</head><body>${body}</body></html>`
}

export function buildSpikePages(localOrigin: string): Record<string, string> {
  const withOrigin = (html: string): string => html.split('__LOCAL__').join(localOrigin)
  return {
    hello: page(
      'orca-spike-local-ok',
      `<p id="o">hello from the spike's local server</p>
<script>post({type:'hello',href:location.href,host:location.host})</script>`
    ),
    ws: page(
      'ws',
      `<p id="o">WebSocket echo...</p>
<script>
var urls=${JSON.stringify(WS_URLS)};
var tries=[];
function tryUrl(i){
  if(i>=urls.length){document.getElementById('o').textContent='failed';post({type:'ws',ok:false,tries:tries});return}
  var url=urls[i],t0=Date.now(),done=false,ws,timer;
  function fail(why){if(done)return;done=true;clearTimeout(timer);tries.push({url:url,err:why});try{ws.close()}catch(e){}tryUrl(i+1)}
  try{ws=new WebSocket(url)}catch(e){return fail('ctor '+e)}
  timer=setTimeout(function(){fail('timeout')},8000);
  ws.onopen=function(){ws.send('orca-spike-ping')};
  ws.onmessage=function(ev){
    if(done||String(ev.data).indexOf('orca-spike-ping')<0)return;
    done=true;clearTimeout(timer);
    document.getElementById('o').textContent='echo ok '+url;
    post({type:'ws',ok:true,url:url,ms:Date.now()-t0,tries:tries});
    ws.close();
  };
  ws.onerror=function(){fail('error')};
  ws.onclose=function(){fail('closed')};
}
tryUrl(0);
</script>`
    ),
    hls: page(
      'hls',
      `<video id="v" muted playsinline autoplay controls style="width:100%" src="${HLS_URL}"></video>
<script>
var v=document.getElementById('v'),t0=Date.now(),finished=false;
function finish(ok,why){
  if(finished)return;finished=true;
  post({type:'hls',ok:ok,why:why,time:v.currentTime,readyState:v.readyState,networkState:v.networkState,errorCode:v.error?v.error.code:null,ms:Date.now()-t0});
}
v.addEventListener('timeupdate',function(){if(v.currentTime>2)finish(true,'played')});
v.addEventListener('error',function(){finish(false,'media error')});
setTimeout(function(){finish(v.currentTime>1,'timeout')},20000);
if(v.play){v.play().catch(function(){})}
</script>`
    ),
    webrtc: page(
      'webrtc',
      `<p id="o">gathering ICE candidates...</p>
<script>
var Ctor=window.RTCPeerConnection||window.webkitRTCPeerConnection;
var out={type:'webrtc',hasRTC:typeof Ctor!=='undefined',candidates:[]};
function ipify(cb){
  fetch('https://api.ipify.org?format=json',{cache:'no-store'}).then(function(r){return r.json()})
    .then(function(j){out.ipifyIp=j.ip;cb()}).catch(function(e){out.ipifyErr=String(e);cb()});
}
function finish(){document.getElementById('o').textContent=JSON.stringify(out.candidates);post(out)}
if(!out.hasRTC){ipify(finish)}else{
  try{
    var pc=new Ctor({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    pc.createDataChannel('spike');
    pc.onicecandidate=function(e){
      if(!e.candidate)return;
      var c=e.candidate;
      out.candidates.push({type:c.type,protocol:c.protocol,address:c.address||String(c.candidate).split(' ')[4]||'?'});
    };
    pc.createOffer().then(function(o){return pc.setLocalDescription(o)}).catch(function(e){out.err=String(e)});
    setTimeout(function(){ipify(finish)},7000);
  }catch(e){out.err=String(e);ipify(finish)}
}
</script>`
    ),
    throughput: page(
      'throughput',
      withOrigin(`<p id="o">running...</p>
<script>
var q=new URLSearchParams(location.search);
var src=q.get('src')||'local',n=+(q.get('n')||20000000);
var url=src==='public'?'https://speed.cloudflare.com/__down?bytes='+n:'__LOCAL__/bytes?n='+n+'&r='+Date.now();
async function run(){
  var out={type:'throughput',src:src,mode:q.get('mode'),n:n};
  try{
    if(src==='local'){
      var pings=[];
      for(var i=0;i<10;i++){var t=performance.now();await (await fetch('__LOCAL__/ping?r='+Math.random(),{cache:'no-store'})).text();pings.push(performance.now()-t)}
      pings.sort(function(a,b){return a-b});
      out.pingMedianMs=Math.round(pings[5]*10)/10;out.pingMaxMs=Math.round(pings[9]*10)/10;
    }
    var t0=performance.now();
    var r=await fetch(url,{cache:'no-store'});
    out.ttfbMs=Math.round(performance.now()-t0);
    var rd=r.body.getReader(),got=0;
    for(;;){var x=await rd.read();if(x.done)break;got+=x.value.length}
    var ms=performance.now()-t0;
    out.bytes=got;out.ms=Math.round(ms);out.mbps=Math.round(got/1e6/(ms/1000)*100)/100;out.ok=got>=n*0.99;
  }catch(e){out.ok=false;out.err=String(e)}
  document.getElementById('o').textContent=JSON.stringify(out);
  post(out);
}
run();
</script>`)
    )
  }
}
