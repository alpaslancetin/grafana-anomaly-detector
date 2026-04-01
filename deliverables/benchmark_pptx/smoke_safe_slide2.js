const P = require('pptxgenjs');
const { imageSizingContain } = require('./pptxgenjs_helpers/image');
const pptx = new P(); const SHAPE=pptx.ShapeType;
function addHeader(slide, section, title, subtitle){slide.addText(section.toUpperCase(),{x:0.58,y:0.28,w:2.8,h:0.18,fontFace:'Aptos',fontSize:9,bold:true,color:'3E7BFA',charSpace:1.5,margin:0});slide.addText(title,{x:0.58,y:0.54,w:8.8,h:0.42,fontFace:'Aptos Display',fontSize:23,bold:true,color:'122033',margin:0});slide.addText(subtitle,{x:0.6,y:1.02,w:8.6,h:0.38,fontFace:'Aptos',fontSize:10.5,color:'526277',margin:0});}
function addCallout(slide,x,y,w,h,title,body,accent){slide.addShape(SHAPE.roundRect,{x,y,w,h,fill:{color:'F8FBFF'},line:{color:accent,pt:1.2}});slide.addText(title,{x:x+0.18,y:y+0.14,w:w-0.32,h:0.22,fontFace:'Aptos',fontSize:10.5,bold:true,color:'122033',margin:0});slide.addText(body,{x:x+0.18,y:y+0.44,w:w-0.32,h:h-0.56,fontFace:'Aptos',fontSize:9.2,color:'526277',margin:0});}
(async()=>{
 pptx.layout='LAYOUT_WIDE'; pptx.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos',lang:'tr-TR'};
 let slide=pptx.addSlide(); slide.background={color:'FBFCFE'}; addHeader(slide,'Functional Quality','Benchmark ozet tablosu','Overall quality chart ve senaryo bazli F1 matrisi ayni slaytta toplandi.');
 const overall='C:\\Users\\alpas\\Documents\\CodexSample\\grafana-anomaly-lab\\deliverables\\benchmark_pptx\\generated_assets_safe\\overall_quality.png';
 slide.addShape(SHAPE.roundRect,{x:0.68,y:1.62,w:5.7,h:2.85,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1}});
 slide.addImage({path:overall,...imageSizingContain(overall,0.88,1.84,5.3,2.4)});
 addCallout(slide,6.64,1.68,5.6,1.05,'Kalite karari','Default mean F1 95.6% | Tuned mean F1 99.3% | Elastic best mean F1 70.7%','2AA66D');
 addCallout(slide,6.64,2.88,5.6,1.05,'Elastic threshold notu','Standard threshold=25 icin recall 9.7% seviyesinde kaldi; best threshold 1.0 oldu.','F2A541');
 addCallout(slide,6.64,4.08,5.6,1.05,'Kodu iyilestiren ana basliklar','Seasonal fallback, window-context score ve panelde point/window/driver detaylarinin acilmasi.','3E7BFA');
 slide.addShape(SHAPE.roundRect,{x:0.68,y:4.82,w:11.56,h:1.52,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1}});
 const sx=0.84, sy=5.02, scenarioCol=2.4, metricCol=1.45;
 slide.addText('Scenario',{x:sx,y:sy,w:scenarioCol,h:0.18,fontFace:'Aptos',fontSize:9.6,bold:true,color:'122033',margin:0});
 slide.addText('Default F1',{x:sx+scenarioCol,y:sy,w:metricCol,h:0.18,fontFace:'Aptos',fontSize:9.6,bold:true,color:'0F8B8D',margin:0,align:'ctr'});
 slide.addText('Tuned F1',{x:sx+scenarioCol+metricCol+0.1,y:sy,w:metricCol,h:0.18,fontFace:'Aptos',fontSize:9.6,bold:true,color:'2AA66D',margin:0,align:'ctr'});
 slide.addText('Elastic best',{x:sx+scenarioCol+2*(metricCol+0.1),y:sy,w:metricCol,h:0.18,fontFace:'Aptos',fontSize:9.6,bold:true,color:'F2A541',margin:0,align:'ctr'});
 const rows=[['Latency spike',100,100,57.1],['Error burst',100,100,66.7],['Traffic drop',100,100,76.9],['Seasonal spike',100,100,100],['Resource step-up',100,100,36.4],['Subtle shift',73.7,95.7,87.0]];
 rows.forEach((r,idx)=>{ const y=sy+0.26+idx*0.19; slide.addText(r[0],{x:sx,y,w:scenarioCol,h:0.16,fontFace:'Aptos',fontSize:8.8,color:'122033',margin:0}); [r[1],r[2],r[3]].forEach((v,vidx)=>{ const x=sx+scenarioCol+vidx*(metricCol+0.1); const fill=v>=95?'E7F6EE':v>=85?'EAF2FF':v>=70?'FFF2DE':'FCE6E6'; const color=v>=95?'2AA66D':v>=85?'3E7BFA':v>=70?'F2A541':'D95D5D'; slide.addShape(SHAPE.roundRect,{x,y:y-0.01,w:metricCol,h:0.16,fill:{color:fill},line:{color:'E0E8F1',pt:0.6}}); slide.addText(v.toFixed(1)+'%',{x,y:y+0.02,w:metricCol,h:0.12,fontFace:'Aptos Display',fontSize:8.4,bold:true,color,margin:0,align:'ctr'}); });});
 await pptx.writeFile({fileName:require('path').join(__dirname,'smoke_safe_slide2.pptx')});
})();
