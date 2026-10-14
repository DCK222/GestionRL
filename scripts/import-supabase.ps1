param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
try {
    $sqlPath = Join-Path $PSScriptRoot 'supabase-roboticlab.sql'
    if (-not (Test-Path -LiteralPath $sqlPath)) {
        $sqlPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'deliverables/supabase-roboticlab.sql'
    }
    if (-not (Test-Path -LiteralPath $sqlPath)) { throw 'No se encuentra supabase-roboticlab.sql junto al lanzador ni en deliverables.' }
    $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
    $psqlPath = if ($psqlCommand) { $psqlCommand.Source } else { $null }
    if (-not $psqlPath) {
        $candidates = @(Get-ChildItem -Path "$env:ProgramFiles/PostgreSQL/*/bin/psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
        if ($candidates.Count -gt 0) { $psqlPath = $candidates[0].FullName }
    }
    if (-not $psqlPath) { throw 'Instala las herramientas de linea de comandos de PostgreSQL (psql) y vuelve a abrir este lanzador.' }
    & $psqlPath --version
    if ($LASTEXITCODE -ne 0) { throw 'No se ha podido iniciar psql.' }
    if ($ValidateOnly) {
        Write-Host 'Cliente PostgreSQL y archivo SQL encontrados. No se ha conectado ni importado nada.'
        exit 0
    }
    Write-Host ''
    Write-Host 'Importacion completa de Roboticlab en qbiqnlhzdovdrglihttg.'
    Write-Host 'En Supabase: Connect > Session pooler. Copia SOLO el valor Host.'
    $dbHost = (Read-Host 'Host (por ejemplo aws-0-eu-west-1.pooler.supabase.com)').Trim()
    if ($dbHost -notmatch '^aws-[a-zA-Z0-9-]+\.pooler\.supabase\.com$') {
        throw 'El host no tiene el formato de Session pooler. Copia solo Host, sin URL, puerto ni contrasena.'
    }
    Write-Host 'A continuacion introduce la CONTRASENA DE LA BASE DE DATOS de Supabase.'
    Write-Host 'No es la contrasena del usuario admin. Al escribirla no se mostraran caracteres.'
    $oldSslMode = $env:PGSSLMODE
    $oldEncoding = $env:PGCLIENTENCODING
    try {
        $env:PGSSLMODE = 'require'
        $env:PGCLIENTENCODING = 'UTF8'
        & $psqlPath -X -W -h $dbHost -p 5432 -U 'postgres.qbiqnlhzdovdrglihttg' -d postgres -v ON_ERROR_STOP=1 -f $sqlPath
        if ($LASTEXITCODE -ne 0) { throw 'La importacion no ha finalizado correctamente. Revisa el error anterior. No continues con la aplicacion hasta resolverlo.' }
    } finally {
        $env:PGSSLMODE = $oldSslMode
        $env:PGCLIENTENCODING = $oldEncoding
    }
    Write-Host ''
    Write-Host 'IMPORTACION COMPLETADA. Ya puedes entrar en la aplicacion con admin.' -ForegroundColor Green
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
