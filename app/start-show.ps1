<#
Starts the party show with one command:  .\start-show.ps1   (from the visuals folder; PowerShell)
  1. starts the web server (serve.py) in its own console window (close that window to stop it)
  2. opens the hologram (hologram.html) and the projector (projector.html) as two Chromium app windows (no tabs, no
     address bar) with their own profile, background throttling off, the microphone allowed
  3. puts each one fullscreen on its own screen: the panel and the projector
Windows display settings first: Extend; the panel LEFT of the projector (or use -Swap).
Uses a Chromium-based browser with its own profile: ungoogled-chromium or Chromium (scoop) if found, else Google Chrome.
(Some browsers pause windows that are not focused; this profile switches that off, so both show windows keep running.)
Options:  -Swap  (the projector is left of the panel)   -NoServer  (the server is already running)   -Port 8080
          -Reposition  (the show is running but a window moved, e.g. after the projector reconnected: put both
                        windows back on their screens, nothing new is started)
          -WallFps 30  (the projector window at 30 frames a second instead of 60: half the work for the wall)
          -Desk  (testing without the panel and the projector: all three windows side by side on the laptop screen)
          -WallOnly  (testing with the projector but without the panel: the projector window fullscreen on the one
                      external screen, the hologram and the dashboard side by side on the laptop screen)
          -Chrome "path\to\chrome.exe"
          -NoWatch  (don't stay running: by default the script keeps watching the screens and, when the projector
                     drops and comes back (Win+K, Win+P Extend), puts the wall window back on it by itself)
#>
param([switch]$Swap, [switch]$NoServer, [switch]$Reposition, [switch]$Desk, [switch]$WallOnly, [switch]$NoWatch, [int]$Port = 8080, [int]$WallFps = 60,
      [string]$Chrome = "")

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Chrome) {                                                                # find a Chromium / Chrome
  $scoop = if ($env:SCOOP) { $env:SCOOP } else { Join-Path $env:USERPROFILE "scoop" }
  $Chrome = @(
    (Join-Path $scoop "apps\ungoogled-chromium\current\chrome.exe"),
    (Join-Path $scoop "apps\chromium\current\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Chromium\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $Chrome -or -not (Test-Path $Chrome)) {
  Write-Host "No Chromium / Chrome found. Install one (e.g. scoop install ungoogled-chromium) or pass -Chrome path\to\chrome.exe" -ForegroundColor Red; exit 1
}
Write-Host "browser: $Chrome"

Add-Type -AssemblyName System.Windows.Forms
$winSrc = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SHOWWIN {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  // a visible window whose title contains 'part', belonging to one of the given process ids
  public static IntPtr Find(string part, uint[] pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.ToString().Contains(part)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# the helper's name carries a hash of its code: a PowerShell window that ran an older version of this script still has
# the old helper loaded (it can't be replaced there), so a changed helper simply gets a new name
$sha = [System.Security.Cryptography.SHA256]::Create()
$tn = "ShowWinV_" + [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($winSrc))).Replace("-", "").Substring(0, 10)
if (-not ([System.Management.Automation.PSTypeName]$tn).Type) { Add-Type ($winSrc.Replace("SHOWWIN", $tn)) }
$W = ([System.Management.Automation.PSTypeName]$tn).Type
$W::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null   # per-monitor: real pixels on every screen

# ---- the two external screens (everything but the laptop's own screen), left to right
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea                   # the laptop's own screen: the dashboard
$dashS = $wa
if ($Desk) {                                                                       # testing: thirds of the laptop screen
  $tw = [int]($wa.Width / 3)
  $holoS = New-Object System.Drawing.Rectangle $wa.X, $wa.Y, $tw, $wa.Height
  $wallS = New-Object System.Drawing.Rectangle ($wa.X + $tw), $wa.Y, $tw, $wa.Height
  $dashS = New-Object System.Drawing.Rectangle ($wa.X + 2 * $tw), $wa.Y, ($wa.Width - 2 * $tw), $wa.Height
} elseif ($WallOnly) {                                                             # testing the wall: no panel
  $ext = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X })
  if ($ext.Count -eq 0) { Write-Host "No external screen: connect the projector (Win+K) and set it to Extend (Win+P)." -ForegroundColor Yellow; exit 1 }
  $wallS = $ext[0].Bounds
  $hw = [int]($wa.Width / 2)
  $holoS = New-Object System.Drawing.Rectangle $wa.X, $wa.Y, $hw, $wa.Height
  $dashS = New-Object System.Drawing.Rectangle ($wa.X + $hw), $wa.Y, ($wa.Width - $hw), $wa.Height
} else {
  $ext = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X })
  if ($ext.Count -lt 2) { Write-Host "Found $($ext.Count) external screen(s); need 2 (the panel and the projector), set to Extend (Win+P)." -ForegroundColor Yellow }
  if ($ext.Count -eq 1) { Write-Host "Only the projector connected? Use .\start-show.ps1 -WallOnly" -ForegroundColor Yellow }
  if ($ext.Count -eq 0) { Write-Host "No external screen. To test on the laptop screen alone: .\start-show.ps1 -Desk" -ForegroundColor Yellow; exit 1 }
  $holoS = $(if ($Swap -and $ext.Count -ge 2) { $ext[1] } else { $ext[0] }).Bounds
  $wallS = $(if ($ext.Count -ge 2) { $(if ($Swap) { $ext[0] } else { $ext[1] }).Bounds } else { $null })
}
Write-Host "hologram screen: $($holoS.Width)x$($holoS.Height) at $($holoS.X),$($holoS.Y)"
if ($wallS) { Write-Host "projector screen: $($wallS.Width)x$($wallS.Height) at $($wallS.X),$($wallS.Y)" }

# ---- the server
if (-not $NoServer -and -not $Reposition) {
  Start-Process python -ArgumentList "serve.py", "--no-open", "--port", "$Port" -WorkingDirectory $here
  Start-Sleep -Seconds 2
}

# ---- Chromium: its own profile, no throttling of background / covered windows, microphone allowed without asking
$profileDir = Join-Path $env:LOCALAPPDATA "HolodancerChromium"
$common = @("--user-data-dir=`"$profileDir`"", "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream")

# a show window of our Chromium, by (part of) its title; waits up to 'tries' x 300 ms
function Find-Show($title, $tries = 50) {
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt $tries -and $hwnd -eq [IntPtr]::Zero; $i++) {
    $pids = [uint32[]]@(Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Chrome } | ForEach-Object { $_.Id })
    if ($pids.Count) { $hwnd = $W::Find($title, $pids) }
    if ($hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 300 }
  }
  return $hwnd
}

# how each window is shown: full (F11 fullscreen on its screen), max (maximised), tile (a plain window in its rectangle)
$modes = @{ Hologram = "full"; Projector = "full"; Dashboard = "max" }
if ($Desk) { $modes = @{ Hologram = "tile"; Projector = "tile"; Dashboard = "tile" } }
if ($WallOnly) { $modes = @{ Hologram = "tile"; Projector = "full"; Dashboard = "tile" } }

# bring a window to the front and check it really is (F11 must never go to another window)
function Focus-Show($hwnd) {
  for ($i = 0; $i -lt 3; $i++) {
    $W::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 250
    if ($W::GetForegroundWindow() -eq $hwnd) { return $true }
    $W::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); $W::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)  # an Alt tap: Windows then lets us switch
  }
  return $false
}
function Press-F11($hwnd, $title) {
  if (Focus-Show $hwnd) { [System.Windows.Forms.SendKeys]::SendWait("{F11}"); return $true }
  Write-Host "Couldn't bring '$title' to the front; click it and press F11." -ForegroundColor Yellow
  return $false
}

# put a window on rectangle $b as its mode says (if it is fullscreen somewhere, F11 takes it out first)
function Place-Show($hwnd, $title, $b, $mode = $null) {
  if (-not $mode) { $mode = $modes[$title] }
  $r = New-Object "$tn+RECT"
  $W::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $onAScreen = [System.Windows.Forms.Screen]::AllScreens | Where-Object {
    $_.Bounds.X -eq $r.Left -and $_.Bounds.Y -eq $r.Top -and $_.Bounds.Right -eq $r.Right -and $_.Bounds.Bottom -eq $r.Bottom }
  if ($onAScreen) {                                                                # fullscreen already: leave it first
    if (Press-F11 $hwnd $title) { Start-Sleep -Milliseconds 700 }
  }
  $W::ShowWindow($hwnd, 1) | Out-Null                                       # normal (not maximised) first
  $W::SetWindowPos($hwnd, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0040) | Out-Null   # onto its screen
  Start-Sleep -Milliseconds 400
  if ($mode -eq "max") { $W::ShowWindow($hwnd, 3) | Out-Null; $W::SetForegroundWindow($hwnd) | Out-Null }
  elseif ($mode -eq "tile") { $W::SetForegroundWindow($hwnd) | Out-Null }
  else {
    if (Press-F11 $hwnd $title) { Start-Sleep -Milliseconds 600 }                    # real fullscreen on that screen
  }
  Write-Host "$title is on its screen." -ForegroundColor Green
}

function Open-Show($page, $title, $b) {
  $argv = $common + @("--app=http://localhost:$Port/$page", "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)")
  Start-Process $Chrome -ArgumentList $argv
  Start-Sleep -Milliseconds 300
  $hwnd = Find-Show $title
  if ($hwnd -eq [IntPtr]::Zero) { Write-Host "Couldn't find the '$title' window." -ForegroundColor Red; return }
  Place-Show $hwnd $title $b
}

if ($Reposition) {                                                                 # the show runs: only move windows
  foreach ($w in @(@("Hologram", $holoS), @("Projector", $wallS))) {
    if (-not $w[1]) { continue }
    $hwnd = Find-Show $w[0] 3
    if ($hwnd -eq [IntPtr]::Zero) { Write-Host "No '$($w[0])' window is open (start the show without -Reposition)." -ForegroundColor Yellow }
    else { Place-Show $hwnd $w[0] $w[1] }
  }
  $hwnd = Find-Show "Dashboard" 3
  if ($hwnd -ne [IntPtr]::Zero) { Place-Show $hwnd "Dashboard" $dashS }
  exit 0
}

Open-Show "hologram.html?autostart" "Hologram" $holoS                     # starts listening to the interface itself
if ($wallS) { Open-Show "projector.html?fps=$WallFps" "Projector" $wallS }
Open-Show "dashboard.html" "Dashboard" $dashS                       # the laptop screen: see and steer both
Write-Host ""
Write-Host "The dashboard (on the laptop screen) shows both screens, the music and buttons for every moment;"
Write-Host "its key pad sends keys to the hologram or the projector (calibration too)."
Write-Host "The hologram starts listening to the SSL 2 / UFO202 by itself; else pick the input at the top of the dashboard."

# ---------------------------------------------------------------- the watcher: put the windows back after a drop
# Miracast can drop. Windows then moves the wall window somewhere else (over the dashboard or the panel). This loop
# parks it small in a corner of the laptop screen, and when the projector is back (Win+K, Win+P Extend) puts it
# fullscreen on it again. Screens are told apart by size (the panel 1920x1080, the HY300 1280x720), else by order.
if ($Desk -or $NoWatch) { exit 0 }
$size = @{ Hologram = $(if ($modes.Hologram -eq "full") { $holoS.Size } else { $null }); Projector = $(if ($wallS) { $wallS.Size } else { $null }) }
$park = @{
  Hologram  = New-Object System.Drawing.Rectangle $wa.X, ($wa.Bottom - 290), 480, 270
  Projector = New-Object System.Drawing.Rectangle ($wa.Right - 500), ($wa.Bottom - 290), 480, 270
}
function Get-Targets {
  $ext = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X })
  $t = @{ Hologram = $null; Projector = $null }
  if ($modes.Hologram -eq "full") {
    $h = $ext | Where-Object { $_.Bounds.Size -eq $size.Hologram } | Select-Object -First 1
    if (-not $h -and $ext.Count -ge 2) { $h = $(if ($Swap) { $ext[1] } else { $ext[0] }) }
    if ($h) { $t.Hologram = $h.Bounds; $ext = @($ext | Where-Object { $_.DeviceName -ne $h.DeviceName }) }
  }
  $w = $ext | Where-Object { $_.Bounds.Size -eq $size.Projector } | Select-Object -First 1
  if (-not $w -and $ext.Count) { $w = $ext[0] }
  if ($w) { $t.Projector = $w.Bounds }
  return $t
}
function Same($r, $b) { [Math]::Abs($r.Left - $b.X) -le 2 -and [Math]::Abs($r.Top - $b.Y) -le 2 -and [Math]::Abs($r.Right - $b.Right) -le 2 -and [Math]::Abs($r.Bottom - $b.Bottom) -le 2 }

Write-Host ""
Write-Host "Watching the screens. If the projector drops: Win+K -> HY300; Extend and the wall come back by itself." -ForegroundColor Cyan
Write-Host "(Keep this window open. Ctrl+C stops only the watching; the show keeps running.)" -ForegroundColor Cyan
$bad = @{ Hologram = 0; Projector = 0 }; $parked = @{ Hologram = $false; Projector = $false }; $lastExtend = [datetime]::MinValue
while ($true) {
  Start-Sleep -Milliseconds 1500
  $t = Get-Targets
  foreach ($name in "Hologram", "Projector") {
    if ($modes[$name] -ne "full") { continue }
    $hwnd = Find-Show $name 1
    if ($hwnd -eq [IntPtr]::Zero) { continue }                                     # (closed)
    $r = New-Object "$tn+RECT"
    $W::GetWindowRect($hwnd, [ref]$r) | Out-Null
    $acted = $false
    if (-not $t[$name]) {                                                          # its screen is gone
      # Miracast connected again but as Duplicate (no screen of its own): switch to Extend (as Win+P would)
      if ($name -eq "Projector" -and ((Get-Date) - $lastExtend).TotalSeconds -gt 15 -and
          (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue |
            Where-Object { $_.Active -and $_.VideoOutputTechnology -eq 15 })) {
        Write-Host "$(Get-Date -Format HH:mm:ss)  the projector is connected as Duplicate: switching to Extend" -ForegroundColor Green
        Start-Process "$env:WINDIR\System32\DisplaySwitch.exe" -ArgumentList "/extend"
        $lastExtend = Get-Date
      }
      if (-not $parked[$name] -and ++$bad[$name] -ge 2) {
        Write-Host "$(Get-Date -Format HH:mm:ss)  the $($name.ToLower()) screen is gone: its window waits in a corner of the laptop screen" -ForegroundColor Yellow
        Place-Show $hwnd $name $park[$name] "tile"
        $parked[$name] = $true; $bad[$name] = 0; $acted = $true
      }
    } elseif (Same $r $t[$name]) { $bad[$name] = 0; $parked[$name] = $false }       # where it belongs
    elseif (++$bad[$name] -ge 3) {                                                 # its screen is there, the window isn't
      Write-Host "$(Get-Date -Format HH:mm:ss)  the $($name.ToLower()) screen is there: putting its window back on it" -ForegroundColor Green
      Place-Show $hwnd $name $t[$name]
      $parked[$name] = $false; $bad[$name] = 0; $acted = $true
    }
    if ($acted) {                                                                  # the dashboard to the front again
      $d = Find-Show "Dashboard" 1
      if ($d -ne [IntPtr]::Zero) { Focus-Show $d | Out-Null }
    }
  }
}
