const PptxGenJS = require('pptxgenjs');
const { imageSizingContain } = require('./pptxgenjs_helpers/image');
(async () => {
 const pptx = new PptxGenJS();
 pptx.layout='LAYOUT_WIDE';
 const slide = pptx.addSlide();
 slide.addText('Generated SVG test', {x:0.5,y:0.4,w:4,h:0.4,fontFace:'Arial',fontSize:22,bold:true});
 const p = require('path').join(__dirname,'generated_assets','overall_quality.svg');
 slide.addImage({ path:p, ...imageSizingContain(p,0.6,1.0,7.0,4.3)});
 await pptx.writeFile({ fileName: require('path').join(__dirname,'smoke_generated_svg.pptx')});
})();
