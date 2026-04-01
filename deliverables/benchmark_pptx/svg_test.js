const PptxGenJS = require('pptxgenjs');
const { imageSizingContain } = require('./pptxgenjs_helpers/image');
(async () => {
 const pptx = new PptxGenJS();
 pptx.layout='LAYOUT_WIDE';
 const slide = pptx.addSlide();
 slide.addText('SVG test', {x:0.5,y:0.5,w:3,h:0.5,fontFace:'Arial',fontSize:24,bold:true});
 const p = require('path').join(__dirname,'..','..','benchmarks','elastic_side_by_side','outputs','visual_report','latency_spike_mad.default.svg');
 slide.addImage({ path:p, ...imageSizingContain(p,0.6,1.2,6,4)});
 await pptx.writeFile({ fileName: require('path').join(__dirname,'svg_test_deck.pptx')});
})();
