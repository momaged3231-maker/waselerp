<#
  WaselERP Print Agent helper.
    .\printer.ps1 -Action list
    .\printer.ps1 -Action raw -Printer "EPSON TM-T20" -Base64 "..."
    .\printer.ps1 -Action test -Printer "EPSON TM-T20"
#>
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Printer = "",
  [string]$Base64 = ""
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WaselRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", CharSet = CharSet.Ansi, SetLastError = true)]
  public static extern IntPtr OpenPrinter(string pPrinterName, out IntPtr pHandle, IntPtr pDefault);

  [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "StartDocPrinterW", SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int Level,
    [In, MarshalAs(UnmanagedType.LPStruct)] DOC_INFO_1 pDocInfo);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
"@

function Send-RawBytes {
  param([string]$PrinterName, [byte[]]$Bytes)

  $handle = [IntPtr]::Zero
  $printer = [IntPtr]::Zero
  try {
    $printer = [WaselRawPrinter]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)
    if ($printer -eq [IntPtr]::Zero) {
      $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw "Cannot open printer '$PrinterName' (Win32 error $code)"
    }

    $docInfo = New-Object WaselRawPrinter+DOC_INFO_1
    $docInfo.pDocName = 'WaselERP Receipt'
    $docInfo.pOutputFile = $null
    $docInfo.pDatatype = 'RAW'
    $started = [WaselRawPrinter]::StartDocPrinter($handle, 1, $docInfo)
    if (-not $started) {
      $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw "StartDocPrinter failed (Win32 error $code)"
    }

    [WaselRawPrinter]::StartPagePrinter($handle) | Out-Null
    $written = 0
    [WaselRawPrinter]::WritePrinter($handle, $Bytes, $Bytes.Length, [ref]$written) | Out-Null
    [WaselRawPrinter]::EndPagePrinter($handle) | Out-Null
    [WaselRawPrinter]::EndDocPrinter($handle) | Out-Null
    return $written
  }
  finally {
    if ($handle -ne [IntPtr]::Zero) { [WaselRawPrinter]::ClosePrinter($handle) | Out-Null }
  }
}

switch ($Action) {
  'list' {
    if (Get-Command Get-Printer -ErrorAction SilentlyContinue) {
      Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json -Depth 3
    } else {
      Get-WmiObject -Class Win32_Printer | Select-Object Name, DriverName, PortName | ConvertTo-Json -Depth 3
    }
  }
  'raw' {
    if (-not $Printer) { throw 'Printer name is required' }
    if (-not $Base64) { throw 'Base64 payload is required' }
    $bytes = [Convert]::FromBase64String($Base64)
    $count = Send-RawBytes -PrinterName $Printer -Bytes $bytes
    Write-Output $count
  }
  'test' {
    if (-not $Printer) { throw 'Printer name is required' }
    $bytes = [byte[]](0x1B, 0x40, 0x1B, 0x61, 0x01, 0x1B, 0x45, 0x01) + [Text.Encoding]::ASCII.GetBytes("WaselERP test`r`n`r`n") + [byte[]](0x1D, 0x56, 0x00)
    $count = Send-RawBytes -PrinterName $Printer -Bytes $bytes
    Write-Output $count
  }
  default { throw "Unknown action '$Action'" }
}

