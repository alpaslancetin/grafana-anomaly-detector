const P = require('pptxgenjs');
const { imageSizingContain } = require('./pptxgenjs_helpers/image');
const pptx = new P(); const SHAPE=pptx.ShapeType;
function addHeader(slide, section, title, subtitle){slide.addText(section.toUpperCase(),{x:0.58,y:0.28,w:2.8,h:0.18,fontFace:'Aptos',fontSize:9,bold:true,color:'3E7BFA',charSpace:1.5,margin:0});slide.addText(title,{x:0.58,y:0.54,w:8.8,h:0.42,fontFace:'Aptos Display',fontSize:23,bold:true,color:'122033',margin:0});slide.addText(subtitle,{x:0.6,y:1.02,w:8.6,h:0.38,fontFace:'Aptos',fontSize:10.5,color:'526277',margin:0});}
function addCallout(slide,x,y,w,h,title,body,accent){slide.addShape(SHAPE.roundRect,{x,y,w,h,fill:{color:'F8FBFF'},line:{color:accent,pt:1.2}});slide.addText(title,{x:x+0.18,y:y+0.14,w:w-0.32,h:0.22,fontFace:'Aptos',fontSize:10.5,bold:true,color:'122033',margin:0});slide.addText(body,{x:x+0.18,y:y+0.44,w:w-0.32,h:h-0.56,fontFace:'Aptos',fontSize:9.2,color:'526277',margin:0});}
(async()=>{ pptx.layout='LAYOUT_WIDE'; pptx.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos',lang:'tr-TR'};
 let slide=pptx.addSlide(); slide.background={color:'FBFCFE'}; addHeader(slide,'Elastic Sensitivity','Threshold sweep ve kod iyilestirmeleri','Elastic threshold duyarliligi ile urune tasinan gelistirmeler ayni karede.');
 const img='C:\\Users\\alpas\\Documents\\CodexSample\\grafana-anomaly-lab\\deliverables\\benchmark_pptx\\generated_assets_safe\\elastic_threshold_sweep.png';
 slide.addShape(SHAPE.roundRect,{x:0.68,y:1.72,w:6.85,h:4.58,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1}});
 slide.addImage({path:img,...imageSizingContain(img,0.92,1.94,6.36,4.08)});
 addCallout(slide,7.88,1.84,4.36,0.96,'Best threshold bulgusu','Elastic icin en iyi toplu F1, threshold=1.0 noktasinda olustu.','F2A541');
 addCallout(slide,7.88,2.96,4.36,0.96,'Seasonal sertlestirme','weekday_hour sparse kaldiginda hour_of_day fallback eklendi.','2AA66D');
 addCallout(slide,7.88,4.08,4.36,0.96,'Window-context scoring','EWMA akisina Elastic benzeri multi-bucket etkisi eklendi.','3E7BFA');
 addCallout(slide,7.88,5.20,4.36,0.96,'Panel explainability','Selected anomaly kartinda point score, window score ve primary driver gosteriliyor.','D95D5D');
 await pptx.writeFile({fileName:require('path').join(__dirname,'smoke_safe_sweep.pptx')});})();
