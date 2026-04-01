const P = require('pptxgenjs');
const pptx = new P();
const SHAPE = pptx.ShapeType;
function safeOuterShadow(color='172434',opacity=0.16,angle=45,blur=2,offset=1){return {type:'outer',color,opacity,angle,blur,offset};}
function addStatCard(slide,x,y,w,h,accent,value,label,note){
 slide.addShape(SHAPE.roundRect,{x,y,w,h,fill:{color:'FFFFFF'},line:{color:'D7DEE8',pt:1},shadow:safeOuterShadow()});
 slide.addShape(SHAPE.roundRect,{x:x+0.18,y:y+0.18,w:0.12,h:h-0.36,fill:{color:accent},line:{color:accent,pt:0}});
 slide.addText(value,{x:x+0.42,y:y+0.24,w:w-0.55,h:0.46,fontFace:'Aptos Display',fontSize:22,bold:true,color:'122033',margin:0});
 slide.addText(label,{x:x+0.42,y:y+0.76,w:w-0.55,h:0.26,fontFace:'Aptos',fontSize:10.5,bold:true,color:'526277',margin:0});
 slide.addText(note,{x:x+0.42,y:y+1.08,w:w-0.55,h:h-1.22,fontFace:'Aptos',fontSize:9,color:'6D7B90',margin:0});
}
function addCallout(slide,x,y,w,h,title,body,accent){slide.addShape(SHAPE.roundRect,{x,y,w,h,fill:{color:'F8FBFF'},line:{color:accent,pt:1.2}}); slide.addText(title,{x:x+0.18,y:y+0.14,w:w-0.32,h:0.22,fontFace:'Aptos',fontSize:10.5,bold:true,color:'122033',margin:0}); slide.addText(body,{x:x+0.18,y:y+0.44,w:w-0.32,h:h-0.56,fontFace:'Aptos',fontSize:9.2,color:'526277',margin:0});}
(async()=>{
 pptx.layout='LAYOUT_WIDE';
 pptx.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos',lang:'tr-TR'};
 let slide=pptx.addSlide(); slide.background={color:'0E223F'};
 slide.addText('GRAFANA ANOMALY DETECTOR',{x:0.62,y:0.46,w:4.6,h:0.26,fontFace:'Aptos',fontSize:10,bold:true,color:'9FD2FF',charSpace:2.2,margin:0});
 slide.addText('Benchmark Sonuclari\nve Elastic Side-by-Side Degerlendirmesi',{x:0.58,y:0.92,w:7.35,h:1.55,fontFace:'Aptos Display',fontSize:26,bold:true,color:'FFFFFF',margin:0});
 slide.addText('Ayni labeled dataset uzerinde kalite, Elastic davranisi ve kapasite limiti.',{x:0.6,y:2.54,w:6.65,h:0.42,fontFace:'Aptos',fontSize:11.5,color:'D7E7FA',margin:0});
 addStatCard(slide,0.62,4.08,2.88,1.55,'2AA66D','99.3%','Bizim tuned mean F1','Ayni benchmark suite icinde erisilen en iyi kalite.');
 addStatCard(slide,3.67,4.08,2.88,1.55,'F2A541','70.7%','Elastic best mean F1','Threshold sweep sonrasi Elastic icin bulunan en iyi seviye.');
 addStatCard(slide,6.72,4.08,2.88,1.55,'0F8B8D','6','Labeled benchmark senaryosu','Latency, error, traffic, seasonal, resource ve subtle shift use caseleri.');
 addStatCard(slide,9.77,4.08,2.88,1.55,'3E7BFA','300','Guvenli detector limiti','Kisa soak sonucuna gore onerilen operasyonel tavan.');
 addCallout(slide,8.05,0.96,4.48,2.1,'Ana karar','Bu benchmark turunda tuned detector, ayni dataset uzerinde Elastic ML trial kosusundan daha iyi performans verdi. Default profil ise 6 use casein 5inde hedef kaliteyi koruyor.','3E7BFA');
 await pptx.writeFile({fileName:require('path').join(__dirname,'smoke_safe_slide1.pptx')});
})();
