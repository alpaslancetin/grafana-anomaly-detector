$srcDir = Join-Path $PSScriptRoot 'slides_explained'
$manifestPath = Join-Path $srcDir 'manifest.json'
$outPath = Join-Path $PSScriptRoot 'Grafana_Anomaly_Detector_Benchmark_TR.pptx'
$previewDir = Join-Path $PSScriptRoot 'rendered_explained'

if (-not (Test-Path $manifestPath)) {
  throw "Manifest bulunamadi: $manifestPath"
}

$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null

$app = New-Object -ComObject PowerPoint.Application
try {
  $presentation = $app.Presentations.Add()
  foreach ($name in $manifest) {
    $file = Join-Path $srcDir $name
    if (-not (Test-Path $file)) {
      throw "Slide deck bulunamadi: $file"
    }
    [void]$presentation.Slides.InsertFromFile($file, $presentation.Slides.Count)
  }
  $presentation.SaveAs($outPath)
  $presentation.Export($previewDir, 'PNG')
  $presentation.Close()
}
finally {
  $app.Quit()
}

Write-Output "Merged:$outPath"
