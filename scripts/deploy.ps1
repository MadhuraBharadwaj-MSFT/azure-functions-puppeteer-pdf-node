[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-zA-Z0-9-]{3,24}$')]
    [string]$NamePrefix,

    [string]$Location,

    [string]$ImageRepository = 'puppeteer-invoice-functions',

    [string]$ImageTag = (Get-Date -Format 'yyyyMMdd-HHmmss')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$templateFile = Join-Path $repoRoot 'infra\main.bicep'
$sampleFile = Join-Path $repoRoot 'samples\invoice.json'

az account show --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Azure CLI is not signed in. Run az login and select the intended subscription.'
}

$parameterArgs = @(
    "namePrefix=$NamePrefix",
    "imageRepository=$ImageRepository",
    "imageTag=$ImageTag"
)
if ($Location) {
    $parameterArgs += "location=$Location"
}

$deploymentArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroupName,
    '--template-file', $templateFile,
    '--parameters'
) + $parameterArgs + @(
    '--only-show-errors',
    '--output', 'json'
)

$deploymentJson = az @deploymentArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Infrastructure deployment failed.'
}
$deployment = $deploymentJson | ConvertFrom-Json
$outputs = $deployment.properties.outputs

$registryName = $outputs.registryName.value
$registryLoginServer = $outputs.registryLoginServer.value
$functionAppName = $outputs.functionAppName.value
$imageName = "$registryLoginServer/$ImageRepository`:$ImageTag"

az acr config authentication-as-arm update `
    --registry $registryName `
    --status Enabled `
    --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to enable ACR ARM-audience authentication.'
}

$runId = az acr build `
    --registry $registryName `
    --image "$ImageRepository`:$ImageTag" `
    $repoRoot `
    --no-logs `
    --no-wait `
    --query runId `
    --output tsv `
    --only-show-errors
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to queue the ACR cloud image build.'
}

$buildStatus = $null
for ($attempt = 1; $attempt -le 60; $attempt++) {
    $buildStatus = az acr task show-run `
        --registry $registryName `
        --run-id $runId `
        --query status `
        --output tsv `
        --only-show-errors
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read ACR build status for run '$runId'."
    }
    if ($buildStatus -in @('Succeeded', 'Failed', 'Canceled', 'Error')) {
        break
    }

    Start-Sleep -Seconds 10
}

if ($buildStatus -ne 'Succeeded') {
    throw "ACR cloud image build '$runId' finished with status '$buildStatus'."
}

az functionapp config container set `
    --name $functionAppName `
    --resource-group $ResourceGroupName `
    --image $imageName `
    --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to update the Function App container image.'
}

az functionapp restart `
    --name $functionAppName `
    --resource-group $ResourceGroupName `
    --only-show-errors
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to restart the Function App.'
}

$baseUrl = "https://$functionAppName.azurewebsites.net"
$info = $null
for ($attempt = 1; $attempt -le 36; $attempt++) {
    try {
        $info = Invoke-RestMethod -Uri "$baseUrl/api/container-info" -TimeoutSec 10
        break
    } catch {
        Start-Sleep -Seconds 10
    }
}
if ($null -eq $info) {
    throw 'The Function App did not become ready within six minutes.'
}

$pdfPath = Join-Path ([System.IO.Path]::GetTempPath()) "$functionAppName-$ImageTag.pdf"
try {
    Invoke-WebRequest `
        -Uri "$baseUrl/api/render-invoice" `
        -Method Post `
        -ContentType 'application/json' `
        -InFile $sampleFile `
        -OutFile $pdfPath `
        -TimeoutSec 90

    $pdfBytes = [System.IO.File]::ReadAllBytes($pdfPath)
    if ($pdfBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($pdfBytes, 0, 5) -ne '%PDF-') {
        throw 'The deployed render-invoice endpoint did not return a valid PDF.'
    }
} finally {
    Remove-Item -LiteralPath $pdfPath -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    FunctionApp = $functionAppName
    Registry = $registryLoginServer
    Image = $imageName
    ContainerInfo = "$baseUrl/api/container-info"
    RenderInvoice = "$baseUrl/api/render-invoice"
    Chromium = $info.chromium.version
    Result = 'PASS'
} | Format-List
