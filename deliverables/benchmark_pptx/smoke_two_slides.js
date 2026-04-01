const PptxGenJS = require('pptxgenjs');
(async () => {
 const pptx = new PptxGenJS();
 pptx.layout='LAYOUT_WIDE';
 let s=pptx.addSlide(); s.addText('slide1',{x:0.5,y:0.5,w:2,h:0.4,fontFace:'Arial',fontSize:24,bold:true});
 s=pptx.addSlide(); s.addText('slide2',{x:0.5,y:0.5,w:2,h:0.4,fontFace:'Arial',fontSize:24,bold:true});
 await pptx.writeFile({ fileName: require('path').join(__dirname,'smoke_two_slides.pptx')});
})();
