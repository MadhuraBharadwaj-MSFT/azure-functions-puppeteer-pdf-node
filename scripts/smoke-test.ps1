[CmdletBinding()]
param(
    [string]$ImageName = 'puppeteer-invoice-functions:local',
    [int]$Port = 8080,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$containerName = "puppeteer-invoice-smoke-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$pdfPath = Join-Path ([System.IO.Path]::GetTempPath()) "$containerName.pdf"
$repoRoot = Split-Path -Parent $PSScriptRoot
$containerStarted = $false

try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $dockerInfo = docker info --format '{{.ServerVersion}}' 2>&1
    $dockerInfoExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($dockerInfoExitCode -ne 0) {
        throw "Docker is unavailable. Start Docker Desktop and retry. Details: $dockerInfo"
    }

    if (-not $SkipBuild) {
        docker build --tag $ImageName $repoRoot
        if ($LASTEXITCODE -ne 0) {
            throw 'Docker image build failed.'
        }
    }

    docker run --detach --rm --name $containerName --publish "${Port}:80" $ImageName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker container failed to start.'
    }
    $containerStarted = $true

    $baseUrl = "http://localhost:$Port"
    $info = $null
    for ($attempt = 1; $attempt -le 36; $attempt++) {
        try {
            $info = Invoke-RestMethod -Uri "$baseUrl/api/container-info" -TimeoutSec 5
            break
        } catch {
            Start-Sleep -Seconds 5
        }
    }

    if ($null -eq $info) {
        docker logs $containerName
        throw 'The Functions host did not become ready within 180 seconds.'
    }
    if (-not $info.chromium.available -or [string]::IsNullOrWhiteSpace($info.chromium.version)) {
        throw 'container-info did not report an available Chromium installation.'
    }

    Invoke-WebRequest `
        -Uri "$baseUrl/api/render-invoice" `
        -Method Post `
        -ContentType 'application/json' `
        -InFile (Join-Path $repoRoot 'samples\invoice.json') `
        -OutFile $pdfPath `
        -TimeoutSec 60

    $pdfBytes = [System.IO.File]::ReadAllBytes($pdfPath)
    if ($pdfBytes.Length -lt 1000) {
        throw "PDF output was unexpectedly small: $($pdfBytes.Length) bytes."
    }

    $signature = [System.Text.Encoding]::ASCII.GetString($pdfBytes, 0, 5)
    if ($signature -ne '%PDF-') {
        throw "PDF signature check failed. Found '$signature'."
    }

    [pscustomobject]@{
        Image = $ImageName
        Node = $info.nodeVersion
        Platform = "$($info.platform)/$($info.architecture)"
        Chromium = $info.chromium.version
        PdfBytes = $pdfBytes.Length
        Result = 'PASS'
    } | Format-List
} finally {
    if ($containerStarted) {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        docker container rm --force $containerName *> $null
        $ErrorActionPreference = $previousErrorActionPreference
    }
    Remove-Item -LiteralPath $pdfPath -Force -ErrorAction SilentlyContinue
}
