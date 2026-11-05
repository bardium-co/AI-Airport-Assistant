# Creates an HTTPS certificate so tablets, kiosks and phones can use the app (and its microphone)
# over the airport network. Run once on the computer that runs the app:  npm run make-cert
#
# It creates a small private "certificate authority" (CA) and a server certificate signed by it, valid for
# this computer's name and its current network addresses. Output (in .\data):
#   tls.pfx + tls.pass            used automatically by the app (restart it afterwards)
#   airport-assistant-ca.crt      install this ONCE on each tablet/kiosk: Settings > Security >
#                                 Encryption & credentials > Install a certificate > CA certificate
# For a permanent installation, a certificate from the airport's IT department (for a real host name)
# is better; then set HTTPS_PFX / HTTPS_PFX_PASSWORD or HTTPS_CERT / HTTPS_KEY instead.
param([string]$OutDir = (Join-Path $PSScriptRoot '..\data'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$ips = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress)
$names = @('localhost', $env:COMPUTERNAME)
$san = (@($names | ForEach-Object { "dns=$_" }) + @($ips | ForEach-Object { "ipaddress=$_" })) -join '&'

$ca = New-SelfSignedCertificate -Type Custom -Subject 'CN=AI Airport Assistant Local CA' `
  -KeyUsage CertSign, CRLSign, DigitalSignature -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=0') `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
  -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(5)

$srv = New-SelfSignedCertificate -Type Custom -Subject "CN=$($env:COMPUTERNAME)" -Signer $ca `
  -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
  -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(2)

$pass = [guid]::NewGuid().ToString('N')
$secure = ConvertTo-SecureString $pass -AsPlainText -Force
Export-PfxCertificate -Cert $srv -FilePath (Join-Path $OutDir 'tls.pfx') -Password $secure -ChainOption BuildChain | Out-Null
Set-Content -Path (Join-Path $OutDir 'tls.pass') -Value $pass -NoNewline
Export-Certificate -Cert $ca -FilePath (Join-Path $OutDir 'airport-assistant-ca.crt') -Type CERT | Out-Null

# The certificates were only needed in the store to sign and export them.
Remove-Item -Path "Cert:\CurrentUser\My\$($srv.Thumbprint)" -Force
Remove-Item -Path "Cert:\CurrentUser\My\$($ca.Thumbprint)" -Force

Write-Host ''
Write-Host 'HTTPS certificate created.'
Write-Host "  Valid for: $($names -join ', '), $($ips -join ', ')"
Write-Host "  Install on each tablet/kiosk once: $(Resolve-Path (Join-Path $OutDir 'airport-assistant-ca.crt'))"
Write-Host '  Then restart the app with:  npm run start:airport'
Write-Host '  (If this computer gets a new network address, run npm run make-cert again.)'
