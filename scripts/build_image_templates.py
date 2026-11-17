"""Rebuild portrait feature vectors after catalogue/portrait updates (offline)."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/experiments'))
# Feature definitions are identical to the validated classical-vision prototype.
from draft_image_poc_v2 import Recognizer
r=Recognizer(ROOT,None)
out=ROOT/'public/image-tools';out.mkdir(parents=True,exist_ok=True)
np.concatenate([r.refs.ravel(),r.banrefs.ravel()]).astype('<f4').tofile(out/'templates.bin')
(out/'templates.json').write_text(json.dumps({'schema':1,'ids':[c['id'] for c in r.champions],
 'names':r.names,'pickLength':r.refs.shape[1],'banLength':r.banrefs.shape[1]},ensure_ascii=False))
atlas=Image.new('L',(16*32,11*32))
for i,c in enumerate(r.champions):
 atlas.paste(Image.open(ROOT/'public'/c['portrait'].lstrip('/')).convert('L').resize((32,32)),((i%16)*32,(i//16)*32))
atlas.save(out/'portrait-atlas.png')
print('Portrait templates:',len(r.champions),r.refs.shape,r.banrefs.shape)
