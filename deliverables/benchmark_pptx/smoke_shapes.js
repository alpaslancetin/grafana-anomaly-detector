const PptxGenJS = require('pptxgenjs');
(async () => {
 const pptx = new PptxGenJS();
 pptx.layout='LAYOUT_WIDE';
 pptx.author='test';
 pptx.theme={ headFontFace:'Aptos Display', bodyFontFace:'Aptos', lang:'tr-TR' };
 const slide = pptx.addSlide();
 slide.background = { color: '0E223F' };
 slide.addText('Header', {x:0.6,y:0.5,w:4,h:0.4,fontFace:'Aptos Display',fontSize:24,bold:true,color:'FFFFFF'});
 slide.addShape(pptx.ShapeType.roundRect, {x:0.7,y:1.5,w:3,h:1.2,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1}});
 slide.addText('99.2%', {x:1.0,y:1.75,w:1.5,h:0.3,fontFace:'Aptos Display',fontSize:22,bold:true,color:'122033'});
 slide.addText('Card', {x:1.0,y:2.1,w:1.5,h:0.2,fontFace:'Aptos',fontSize:10,bold:true,color:'526277'});
 await pptx.writeFile({ fileName: require('path').join(__dirname,'smoke_shapes.pptx')});
})();
