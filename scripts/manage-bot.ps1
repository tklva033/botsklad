$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bundledNode = "C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Get-Command node -ErrorAction SilentlyContinue) {
  $node = (Get-Command node).Source
} elseif (Test-Path $bundledNode) {
  $node = $bundledNode
} else {
  throw "Node.js not found. Install Node.js or update scripts/manage-bot.ps1 with the correct path."
}

$action = if ($args.Count -gt 0) { $args[0] } else { "status" }

Set-Location $root
& $node "scripts/service-manager.js" $action
