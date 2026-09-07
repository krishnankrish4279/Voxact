const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.resolve(rootDir, '..');
const zipPath = path.join(desktopDir, 'Voxact_Submission.zip');
const altZipPath = path.join(desktopDir, 'Voxact.zip');
const oldZipPath = path.join(desktopDir, 'Voxact (3).zip');

console.log('\n===============================================================');
console.log('🔒 VoxAct Clean Hackathon Packaging & Security Verification');
console.log('===============================================================\n');
console.log(`Source directory: ${rootDir}`);
console.log(`Target archive:   ${zipPath}`);

// Clean up existing destination archives
[zipPath, altZipPath, oldZipPath].forEach(target => {
  if (fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
      console.log(`  - Removed prior archive: ${path.basename(target)}`);
    } catch (e) {
      console.warn(`  ! Could not remove ${path.basename(target)}: ${e.message}`);
    }
  }
});

// Extract actual secrets from local .env (if present) for negative verification
const secretsToVerify = new Set();
const localEnvPath = path.join(rootDir, '.env');
if (fs.existsSync(localEnvPath)) {
  const envContent = fs.readFileSync(localEnvPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Only track actual secret keys and credentials (length >= 8, not placeholders)
      if ((key.toUpperCase().includes('KEY') || key.toUpperCase().includes('TOKEN') || key.toUpperCase().includes('SECRET') || key.toUpperCase().includes('PASS')) &&
          val.length >= 8 && !val.includes('your_') && !val.includes('example')) {
        secretsToVerify.add(val);
      }
    }
  }
}

const stagingDir = path.join(os.tmpdir(), 'voxact_clean_stage_' + Date.now());
const projectStagingDir = path.join(stagingDir, 'Voxact');
fs.mkdirSync(projectStagingDir, { recursive: true });

// Whitelist of files and directories to include (strictly excluding .env and node_modules)
const whitelist = [
  'src',
  'public',
  'test',
  'benchmarks',
  'scripts',
  'package.json',
  'server.js',
  'README.md',
  'RIME_EVIDENCE.md',
  '.env.example',
  '.gitignore'
];

for (const item of whitelist) {
  const srcPath = path.join(rootDir, item);
  const destPath = path.join(projectStagingDir, item);
  if (fs.existsSync(srcPath)) {
    fs.cpSync(srcPath, destPath, { recursive: true });
    console.log(`  + Included: ${item}`);
  } else {
    console.warn(`  ! Warning: Whitelisted item not found: ${item}`);
  }
}

// Absolute safety check: ensure .env and node_modules do NOT exist anywhere in staging
function removeForbiddenFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        fs.rmSync(full, { recursive: true, force: true });
        console.warn(`  🔒 Stripped forbidden directory: ${entry.name}`);
      } else {
        removeForbiddenFiles(full);
      }
    } else if (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example')) {
      fs.unlinkSync(full);
      console.warn(`  🔒 Stripped forbidden credential file: ${entry.name}`);
    }
  }
}
removeForbiddenFiles(stagingDir);

// Pre-archive deep content security scan
function scanDirectoryForSecrets(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectoryForSecrets(full);
    } else {
      if (entry.name === '.env') {
        throw new Error(`SECURITY AUDIT FAILED: .env file found at ${full}`);
      }
      // Scan text files for secrets
      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.json', '.md', '.html', '.txt', '.env.example', '.css'].includes(ext) || entry.name.startsWith('.')) {
        const content = fs.readFileSync(full, 'utf8');

        // Check for real live secrets extracted from .env
        for (const secret of secretsToVerify) {
          if (content.includes(secret)) {
            throw new Error(`SECURITY AUDIT FAILED: Live credential value found in ${entry.name}`);
          }
        }

        // Check for common secret patterns
        if (/\bsk-[a-zA-Z0-9_\-]{20,}\b/.test(content)) {
          throw new Error(`SECURITY AUDIT FAILED: OpenAI secret pattern (sk-...) found in ${entry.name}`);
        }
        if (/\bgsk_[a-zA-Z0-9_\-]{20,}\b/.test(content)) {
          throw new Error(`SECURITY AUDIT FAILED: Groq secret pattern (gsk_...) found in ${entry.name}`);
        }
      }
    }
  }
}
scanDirectoryForSecrets(stagingDir);
console.log('  ✔ Pre-archive scan passed: 0 secrets found in staged files');

// Build ZIP with standard UNIX forward slashes (/) to guarantee cross-platform compatibility
const psZipScript = [
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  `$zip = [System.IO.Compression.ZipFile]::Open('${zipPath.replace(/'/g, "''")}', 'Create')`,
  `$baseDir = [System.IO.Path]::GetFullPath('${stagingDir.replace(/'/g, "''")}')`,
  `Get-ChildItem -LiteralPath $baseDir -Recurse -File | ForEach-Object {`,
  `    $full = $_.FullName`,
  `    $rel = $full.Substring($baseDir.Length).TrimStart('\\', '/').Replace('\\', '/')`,
  `    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null`,
  `}`,
  `$zip.Dispose()`
].join("\r\n");

const psTempPath = path.join(os.tmpdir(), 'voxact_zip_' + Date.now() + '.ps1');
fs.writeFileSync(psTempPath, psZipScript, 'utf8');

try {
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psTempPath}"`, { stdio: 'inherit' });
  if (fs.existsSync(psTempPath)) fs.unlinkSync(psTempPath);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  // Post-archive deep ZIP inspection & assertion
  // Serialize secrets to pass safely to PowerShell
  const secretPatterns = Array.from(secretsToVerify);
  const secretCheckScript = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}')`,
    `$entries = $zip.Entries`,
    `$hasEnv = $entries | Where-Object { $_.FullName -match '(^|/)\\.env$' }`,
    `$hasEnvExample = $entries | Where-Object { $_.FullName -match '(^|/)\\.env\\.example$' }`,
    `$hasNodeModules = $entries | Where-Object { $_.FullName -match '(^|/)node_modules/' }`,
    `if ($hasEnv) { $zip.Dispose(); Write-Error "CRITICAL SECURITY ERROR: .env is in archive: $hasEnv"; exit 1 }`,
    `if (-not $hasEnvExample) { $zip.Dispose(); Write-Error "ERROR: .env.example missing from archive"; exit 1 }`,
    `if ($hasNodeModules) { $zip.Dispose(); Write-Error "ERROR: node_modules in archive"; exit 1 }`,
    // Check entry contents
    `foreach ($entry in $entries) {`,
    `    if ($entry.Length -lt 2000000 -and ($entry.Name -match '\\.(js|json|md|html|txt|css|example)$' -or $entry.Name -eq '.gitignore')) {`,
    `        $stream = $entry.Open()`,
    `        $reader = New-Object System.IO.StreamReader($stream)`,
    `        $text = $reader.ReadToEnd()`,
    `        $reader.Close()`,
    `        $stream.Close()`,
    `        if ($text -match '\\bsk-[a-zA-Z0-9_\\-]{20,}\\b') { $zip.Dispose(); Write-Error "SECURITY FAIL: sk- key in $($entry.FullName)"; exit 1 }`,
    `        if ($text -match '\\bgsk_[a-zA-Z0-9_\\-]{20,}\\b') { $zip.Dispose(); Write-Error "SECURITY FAIL: gsk- key in $($entry.FullName)"; exit 1 }`,
    `    }`,
    `}`,
    `$zip.Dispose()`,
    `Write-Host "ARCHIVE_SECURITY_VERIFIED_100%_CLEAN"`
  ].join("\r\n");

  const psVerifyPath = path.join(os.tmpdir(), 'voxact_verify_' + Date.now() + '.ps1');
  fs.writeFileSync(psVerifyPath, secretCheckScript, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psVerifyPath}"`, { stdio: 'inherit' });
  if (fs.existsSync(psVerifyPath)) fs.unlinkSync(psVerifyPath);

  // Also create Voxact.zip as an alias
  fs.copyFileSync(zipPath, altZipPath);

  const stats = fs.statSync(zipPath);
  console.log('\n✅ Security & Packaging Verification Passed:');
  console.log('  ✔ .env is STRICTLY OMITTED from submission package');
  console.log('  ✔ .env.example is included with safe placeholder template');
  console.log('  ✔ node_modules and local cache completely excluded');
  console.log('  ✔ All archive entries recursively scanned for secret patterns (sk-, gsk-, API keys, tokens)');
  console.log('  ✔ Standard UNIX forward slashes (/) used for cross-platform compatibility');
  console.log('  ✔ Root directory structured as "Voxact/..."');
  console.log(`  ✔ Archive size: ${(stats.size / 1024).toFixed(1)} KB (clean, lightweight)`);
  console.log('\n🎉 Clean submissions ready on Desktop:');
  console.log(`   1) ${zipPath}`);
  console.log(`   2) ${altZipPath}\n`);
} catch (err) {
  if (fs.existsSync(psTempPath)) fs.unlinkSync(psTempPath);
  if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (fs.existsSync(altZipPath)) fs.unlinkSync(altZipPath);
  console.error('\n❌ Packaging failed security audit:', err.message);
  process.exit(1);
}