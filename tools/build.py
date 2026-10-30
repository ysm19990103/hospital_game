#!/usr/bin/env python3
"""Build the browser game and a self-contained HTML with all main and side-story videos."""
import argparse,base64,io,json,pathlib,re,mimetypes
ROOT=pathlib.Path(__file__).resolve().parents[1]
def assemble():
 chapters=[]
 for file in sorted((ROOT/'data').glob('chapters-*.json')):
  chapters.extend(json.loads(file.read_text()))
 source={x['id']:x for x in chapters}; timeline=json.loads((ROOT/'data/timeline.json').read_text())
 if len(source)!=len(chapters):raise ValueError('Duplicate chapter ID')
 if len({t['sourceId'] for t in timeline})!=len(timeline) or {t['sourceId'] for t in timeline}!=set(source):raise ValueError('Timeline must include each chapter exactly once')
 ordered=[]
 for i,t in enumerate(timeline):
  c=source[t['sourceId']];c.update({'gameOrder':i+1,'phase':t['phase'],'timelineNote':t['timeNote'],'presentation':'video'})
  c['timeNote']=c.get('timeNote') or ('晚年 · 退休后的生活' if t['sourceId']==27 else '时光重返 · 外层现实仍在职业转折' if t['sourceId'] in (15,25) else '异境经历 · 回到现实再继续前行' if t['sourceId'] in (21,26) else t['phase']+' · '+c.get('tagline','在现实与异界之间'))
  if t['sourceId']==28:c.setdefault('flags',{})['familyBetrayalForeshadowed']=True
  ordered.append(c)
 assert len(ordered)==len(source)
 (ROOT/'data/chapters.json').write_text(json.dumps(ordered,ensure_ascii=False,indent=2))
def bundle(offline_media_root=None,inline_lossless_webp=False,browser_only=False):
 modules={}
 def add(path):
  rel=path.relative_to(ROOT).as_posix()
  if rel in modules:return
  text=path.read_text();modules[rel]=text
  if path.suffix=='.json':return
  for name in re.findall(r"require\(['\"]([^'\"]+)['\"]\)",text):
   child=(path.parent/name).resolve()
   if not child.suffix:child=child.with_suffix('.js')
   add(child)
 add(ROOT/'src/app.js')
 out=['(function(){"use strict";const modules={};const cache={};']
 for name,text in modules.items():
  body='module.exports='+text+';' if name.endswith('.json') else text
  out.append('modules['+json.dumps(name)+']=function(require,module,exports){\n'+body+'\n};')
 out.append('function norm(p){const a=[];p.split("/").forEach(x=>{if(x==="..")a.pop();else if(x&&x!==".")a.push(x)});return a.join("/")}function req(name,from){let key=norm((from?from.slice(0,from.lastIndexOf("/")+1):"")+name);if(!/\\.(js|json)$/.test(key))key+=".js";if(cache[key])return cache[key].exports;if(!modules[key])throw Error("Missing module "+key);const m={exports:{}};cache[key]=m;modules[key](n=>req(n,key),m,m.exports);return m.exports;}req("src/app.js","");})();')
 js='\n'.join(out);(ROOT/'browser.js').write_text(js)
 base='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>白衣志怪录 · 李晨光</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff9ed;touch-action:none}canvas{display:block;width:100vw;height:100vh;touch-action:none}*{box-sizing:border-box}</style><body><canvas id="game" aria-label="白衣志怪录游戏画面"></canvas>'
 (ROOT/'index.html').write_text(base+'<script src="browser.js"></script></body></html>')
 if browser_only:
  print(json.dumps({'mode':'browser','modules':len(modules),'output':['browser.js','index.html']}))
  return
 assets={}
 for path in sorted((ROOT/'assets').rglob('*')):
  if path.is_file() and path.suffix in ('.jpg','.png','.webp'):
   if path.name=='lichenguang-player.png':continue
   if path.name=='halloween-death.png' and (path.parent/'halloween-death.jpg').exists():continue
   data=path.read_bytes();mime=mimetypes.guess_type(path.name)[0]
   if inline_lossless_webp and path.suffix=='.png':
    from PIL import Image
    encoded=io.BytesIO()
    with Image.open(path) as source_image:source_image.save(encoded,format='WEBP',lossless=True,method=6,exact=True)
    if len(encoded.getvalue())<len(data):data=encoded.getvalue();mime='image/webp'
   assets[path.relative_to(ROOT).as_posix()]='data:'+mime+';base64,'+base64.b64encode(data).decode()
 side_stories=json.loads((ROOT/'data/side-stories.json').read_text())
 main_chapters=json.loads((ROOT/'data/chapters.json').read_text())
 videos=[ROOT/c.get('video',f'media/ch{c["id"]:02d}.mp4') for c in main_chapters]+[ROOT/v['video'] for v in side_stories]
 if len(set(videos))!=len(videos):raise ValueError('Duplicate video path in catalog')
 missing=[str(p.relative_to(ROOT)) for p in videos if not p.is_file() or p.stat().st_size==0]
 if missing:raise FileNotFoundError('Complete chapter videos are required: '+', '.join(missing))
 offline_videos=[(offline_media_root/p.relative_to(ROOT)) if offline_media_root else p for p in videos]
 missing=[str(p) for p in offline_videos if not p.is_file() or p.stat().st_size==0]
 if missing:raise FileNotFoundError('Complete offline video set is required: '+', '.join(missing))
 offline_path=ROOT/'Baiyi_Offline_Game.html'
 staging_dir=ROOT/'tools'/'.build-staging'
 staging_dir.mkdir(parents=True,exist_ok=True)
 staged_path=staging_dir/(offline_path.name+'.tmp')
 # Stream the output so building does not hold all encoded videos in memory.
 with staged_path.open('w',encoding='utf-8') as out:
  out.write(base+'<script>window.BAIYI_ASSETS='+json.dumps(assets,separators=(',',':'))+';</script>')
  out.write('<script>window.BAIYI_VIDEOS={\n')
  for i,path in enumerate(videos):
   if i:out.write(',\n')
   out.write(json.dumps(path.relative_to(ROOT).as_posix())+':')
   out.write(json.dumps(base64.b64encode(offline_videos[i].read_bytes()).decode('ascii')))
  out.write('\n};</script><script>'+js.replace('</script','<\\/script')+'</script></body></html>')
 staged_path.replace(offline_path)
 print(json.dumps({'chapters':len(main_chapters),'side_stories':len(side_stories),'modules':len(modules),'assets':len(assets),'embedded_videos':len(videos),'inline_lossless_webp':inline_lossless_webp,'offline_bytes':offline_path.stat().st_size}))
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--offline-media-root',type=pathlib.Path,help='Optional root containing a complete optimized media/ tree for the standalone HTML; native project media stays unchanged.')
 parser.add_argument('--inline-lossless-webp',action='store_true',help='Losslessly encode PNG images as WebP when smaller, only inside the standalone HTML (requires Pillow).')
 parser.add_argument('--browser-only',action='store_true',help='Build browser.js and index.html without embedding videos in a second large HTML file.')
 args=parser.parse_args()
 assemble();bundle(args.offline_media_root.resolve() if args.offline_media_root else None,args.inline_lossless_webp,args.browser_only)
