const P = require('pptxgenjs');
const { imageSizingContain } = require('./pptxgenjs_helpers/image');
const pptx = new P(); const SHAPE=pptx.ShapeType;
function safeOuterShadow(color='172434',opacity=0.16,angle=45,blur=2,offset=1){return {type:'outer',color,opacity,angle,blur,offset};}
function addHeader(slide, section, title, subtitle){slide.addText(section.toUpperCase(),{x:0.58,y:0.28,w:2.8,h:0.18,fontFace:'Aptos',fontSize:9,bold:true,color:'3E7BFA',charSpace:1.5,margin:0});slide.addText(title,{x:0.58,y:0.54,w:8.8,h:0.42,fontFace:'Aptos Display',fontSize:23,bold:true,color:'122033',margin:0});slide.addText(subtitle,{x:0.6,y:1.02,w:8.6,h:0.38,fontFace:'Aptos',fontSize:10.5,color:'526277',margin:0});}
function addStatCard(slide,x,y,w,h,accent,value,label,note){slide.addShape(SHAPE.roundRect,{x,y,w,h,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1},shadow:safeOuterShadow()});slide.addShape(SHAPE.roundRect,{x:x+0.18,y:y+0.18,w:0.12,h:h-0.36,fill:{color:accent},line:{color:accent,pt:0}});slide.addText(value,{x:x+0.42,y:y+0.24,w:w-0.55,h:0.46,fontFace:'Aptos Display',fontSize:22,bold:true,color:'122033',margin:0});slide.addText(label,{x:x+0.42,y:y+0.76,w:w-0.55,h:0.26,fontFace:'Aptos',fontSize:10.5,bold:true,color:'526277',margin:0});slide.addText(note,{x:x+0.42,y:y+1.08,w:w-0.55,h:h-1.22,fontFace:'Aptos',fontSize:9,color:'6D7B90',margin:0});}
(async()=>{ pptx.layout='LAYOUT_WIDE'; pptx.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos',lang:'tr-TR'};
 let slide=pptx.addSlide(); slide.background={color:'FFFFFF'}; addHeader(slide,'Capacity Envelope','Kapasite, soak ve karar','Teknik limit ile guvenli operasyon seviyesi ayri okunmali.');
 const img='C:\\Users\\alpas\\Documents\\CodexSample\\grafana-anomaly-lab\\deliverables\\benchmark_pptx\\generated_assets_safe\\capacity_envelope.png';
 slide.addShape(SHAPE.roundRect,{x:0.68,y:1.72,w:7.2,h:4.55,fill:{color:'F9FBFE'},line:{color:'D7DEE8',pt:1}});
 slide.addImage({path:img,...imageSizingContain(img,0.94,1.94,6.7,4.02)});
 addStatCard(slide,8.45,1.84,4.05,1.16,'2AA66D','300 | PASS','Soak verdict','Evaluation duration 1.28s tavaninda kaldi.');
 addStatCard(slide,8.45,3.16,4.05,1.16,'F2A541','350 | RISK','Borderline zone','Bir ornekte 1.60s goruldu.');
 addStatCard(slide,8.45,4.48,4.05,1.16,'D95D5D','400 | RISK','Unsafe without optimization','Iki ornekte 1.78s seviyesine cikti.');
 slide.addText('Karar: beta rollout icin kaliteli benchmark kaniti hazir. Operasyonel planlama 300 detector ile baslamali.',{x:0.74,y:6.5,w:11.4,h:0.28,fontFace:'Aptos',fontSize:10,bold:true,color:'122033',margin:0});
 await pptx.writeFile({fileName:require('path').join(__dirname,'smoke_safe_capacity.pptx')});})();
