param(
  [int]$Count = 100,
  [switch]$Color,
  [switch]$Slow,
  [int]$DelayMs = 10,
  [string]$LogPath = ".\\render-verify.log"
)

$esc = [char]27
if (Test-Path -LiteralPath $LogPath) {
  Remove-Item -LiteralPath $LogPath -Force
}

function New-TestLine([int]$i, [bool]$useColor) {
  $id = '{0:D3}' -f $i
  $plain = "[L$id]|queryKeywords|ABCDEFGHIJKLMNOPQRSTUVWXYZ|abcdefghijklmnopqrstuvwxyz|0123456789|中文宽度测试|END[L$id]"

  if (-not $useColor) {
    return $plain
  }

  $c1 = "$esc[38;2;255;120;0mC1-$id$esc[0m"
  $c2 = "$esc[48;2;20;90;200m$esc[38;2;255;255;255m C2-$id $esc[0m"
  $c3 = "$esc[38;2;120;220;120mC3-$id$esc[0m"
  return "$c1|$c2|$c3|AFTER:$plain"
}

$expected = @{}
for ($i = 1; $i -le $Count; $i++) {
  $line = New-TestLine -i $i -useColor:$Color

  [Console]::Out.WriteLine($line)

  $plainForFile = "[L{0:D3}]|queryKeywords|ABCDEFGHIJKLMNOPQRSTUVWXYZ|abcdefghijklmnopqrstuvwxyz|0123456789|中文宽度测试|END[L{0:D3}]" -f $i
  Add-Content -LiteralPath $LogPath -Value $plainForFile -Encoding utf8
  $expected[$i] = $plainForFile

  if ($Slow) {
    Start-Sleep -Milliseconds $DelayMs
  }
}

$actual = Get-Content -LiteralPath $LogPath -Encoding utf8
$missing = @()
for ($i = 1; $i -le $Count; $i++) {
  $target = $expected[$i]
  if (-not ($actual -contains $target)) {
    $missing += $i
  }
}

Write-Host ""
Write-Host "========== VERIFY =========="
Write-Host ("Expected lines : {0}" -f $Count)
Write-Host ("Actual lines   : {0}" -f $actual.Count)
if ($missing.Count -eq 0) {
  Write-Host "Missing IDs    : none"
} else {
  Write-Host ("Missing IDs    : {0}" -f ($missing -join ', '))
}
Write-Host ("Log file       : {0}" -f (Resolve-Path -LiteralPath $LogPath))
