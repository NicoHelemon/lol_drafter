// Local assets only: image analysis must never depend on a third-party CDN.
import {mkdir,copyFile} from 'node:fs/promises';
const root=new URL('../public/image-tools/',import.meta.url);
await mkdir(root,{recursive:true});
await mkdir(new URL('core/',root),{recursive:true});
for(const name of ['worker.min.js','worker.min.js.LICENSE.txt'])await copyFile(new URL('../node_modules/tesseract.js/dist/'+name,import.meta.url),new URL(name,root));
for(const variant of ['lstm','simd-lstm','relaxedsimd-lstm'])for(const ext of ['wasm.js','wasm']){
 const name=`tesseract-core-${variant}.${ext}`;
 await copyFile(new URL('../node_modules/tesseract.js-core/'+name,import.meta.url),new URL('core/'+name,root));
}
await copyFile(new URL('../node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',import.meta.url),new URL('eng.traineddata.gz',root));
await copyFile(new URL('../node_modules/tesseract.js-core/LICENSE',import.meta.url),new URL('TESSERACT_LICENSE',root));
await copyFile(new URL('../node_modules/tesseract.js/LICENSE.md',import.meta.url),new URL('TESSERACT_JS_LICENSE',root));
await copyFile(new URL('../node_modules/@techstark/opencv-js/LICENSE',import.meta.url),new URL('OPENCV_LICENSE',root));
console.log('Local OCR assets prepared');
