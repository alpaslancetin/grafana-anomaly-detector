const PptxGenJS = require('pptxgenjs');
const { imageSizingContain } = require('./pptxgenjs_helpers/image');
const path = require('path');
(async () => {
 const pptx = new PptxGenJS();
 pptx.layout='LAYOUT_WIDE';
 const slide = pptx.addSlide();
 slide.addText('Visual trio', {x:0.5,y:0.3,w:4,h:0.4,fontFace:'Arial',fontSize:22,bold:true});
 ['default','tuned','elastic'].forEach((variant,idx)=>{
   const p = path.join(__dirname,'..','..','benchmarks','elastic_side_by_side','outputs','visual_report',`subtle_level_shift_ewma.${variant}.svg`);
   const x = 0.6 + idx*4.1;
   slide.addShape(pptx.ShapeType.roundRect,{x,y:1.0,w:3.7,h:4.6,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1}});
   slide.addImage({ path:p, ...imageSizingContain(p,x+0.15,1.3,3.35,3.6)});
 });
 await pptx.writeFile({ fileName: path.join(__dirname,'smoke_visual_trio.pptx')});
})();
