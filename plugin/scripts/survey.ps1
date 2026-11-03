#requires -Version 5.1
<#
ヒキツギの調査スクリプト。PC 1台の情報を読み取り、今いるフォルダの JSON ファイル1つに保存する。

決まり
- 読み取り専用。設定の変更、結果以外のファイルの書き換え、ネットワークへの送信、他の機器への走査をしない
- Windows PowerShell 5.1 の標準機能だけで動く。管理者権限を求めない
- 同意があるまで何も集めない。そのため、同意の確認をファイルの先頭に置く
- 権限がなくて取れない項目は denied、それ以外で取れない項目は unavailable と記録して、止まらずに続ける

注意
- ファイルは BOM つき UTF-8 で保存する。5.1 は BOM がないと日本語を読み違える
- 自分で定義する関数の名前は「動詞-名詞」の形にしない。合格テストが、許可していないコマンドとして止める
- 日付は和暦の設定でも形が変わらないよう、InvariantCulture で文字列にする
- 関数の引数に「文字列.メソッド()」をそのまま書くと、全体が1つの文字列になる。かっこで包む
#>

Write-Host ''
Write-Host 'ヒキツギの調査を始める前に、内容を確認してください。'
Write-Host ''
Write-Host '【集める内容】'
Write-Host '  ・PC 名、Windows の名前とバージョン'
Write-Host '  ・PC のメーカー、型番、メモリの大きさ、C ドライブの空き容量'
Write-Host '  ・ネットワークの設定（自動か固定か、ゲートウェイ、DNS、接続中の Wi-Fi の名前）'
Write-Host '  ・共有フォルダ（ネットワーク ドライブ）の接続先'
Write-Host '  ・プリンターの名前と接続先'
Write-Host '  ・インストールされているソフトの名前とバージョン'
Write-Host '  ・セキュリティの状態（最後の更新日、大型更新の保留、ウイルス対策、BitLocker）'
Write-Host '  ・アカウントの種類（ドメイン、クラウド参加、ワークグループのどれか）と、Microsoft 365 にサインイン済みかどうか'
Write-Host ''
Write-Host '【集めない内容】'
Write-Host '  ・パスワード、Wi-Fi のパスワード、保存済みの認証情報'
Write-Host '  ・ファイルの中身、メールの中身、閲覧履歴'
Write-Host '  ・個人のユーザーフォルダの一覧'
Write-Host '  ・他の PC やネットワーク機器の情報'
Write-Host ''
Write-Host 'PC の設定は変えません。結果はどこにも送らず、今いるフォルダに保存するだけです。'
Write-Host ''
$answer = Read-Host '調査を始めてよければ y を入力して Enter を押してください'
$answer = "$answer".Trim()
if ($answer -ne 'y') {
    Write-Host '調査をやめました。何も集めていません。'
    exit 0
}

# ここから下は、同意のあとにだけ実行される

$ErrorActionPreference = 'Stop'
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$results = [System.Collections.ArrayList]::new()

# 値の型をここでそろえる。PowerShell が値に付ける追加の情報が JSON に混ざらないよう、文字列は作り直す
function AddResult($category, $key, $value, $status) {
    if ($status -ne 'ok') { $value = $null }
    elseif ($value -is [bool]) { $value = [bool]$value }
    elseif ($value -is [int]) { $value = [int]$value }
    else { $value = "$value" }
    $record = [ordered]@{ category = $category; key = $key; value = $value; status = $status }
    $null = $script:results.Add($record)
}

# 権限がなくて取れなかったのか、それ以外で取れなかったのかを分ける
function StatusFromError($failure) {
    $exception = $failure.Exception
    if ("$($failure.CategoryInfo.Category)" -eq 'PermissionDenied') { return 'denied' }
    if ($exception -is [System.UnauthorizedAccessException]) { return 'denied' }
    if ("$exception" -match 'アクセスが拒否|アクセス拒否|Access is denied|Access denied|0x80070005|0x80041003') { return 'denied' }
    return 'unavailable'
}

# 1項目を読む。失敗しても記録して、次の項目へ続ける
function CollectOne($category, $key, [scriptblock]$reader) {
    try {
        $collected = & $reader
        if ($null -eq $collected -or "$collected" -eq '') { AddResult $category $key $null 'unavailable' }
        else { AddResult $category $key $collected 'ok' }
    } catch {
        AddResult $category $key $null (StatusFromError $_)
    }
}

function ReadCim($className) {
    Get-CimInstance -ClassName $className -ErrorAction Stop
}

function ReadRegistry($path) {
    if (Test-Path -LiteralPath $path) { Get-ItemProperty -LiteralPath $path -ErrorAction Stop }
}

function CleanText($text) {
    "$text".Trim()
}

# バイト数を GB の整数にする。メモリは表示に近い四捨五入、空き容量は多く見せない切り捨て
function RoundGb($bytes) {
    if ($null -ne $bytes) { [int][math]::Round([double]$bytes / 1GB) }
}

function FloorGb($bytes) {
    if ($null -ne $bytes) { [int][math]::Floor([double]$bytes / 1GB) }
}

# 接続中の Wi-Fi の名前だけを読む。つながっていなければ何も返さない
function ReadWifiName {
    foreach ($line in @(netsh wlan show interfaces)) {
        if ($line -match '^\s*SSID\s*:\s*(.+?)\s*$') { return $Matches[1] }
    }
}

# 設定画面の保留と、会社のポリシーの保留のどちらかがあれば「保留」とする
function ReadFeatureUpdate {
    $held = $false
    $policy = ReadRegistry 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
    if ($policy) {
        if ($policy.DeferFeatureUpdates -eq 1 -or $policy.TargetReleaseVersion -eq 1) { $held = $true }
    }
    $settings = ReadRegistry 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
    if ($settings) {
        if ($settings.DeferFeatureUpdatesPeriodInDays -gt 0) { $held = $true }
        if ($settings.PauseFeatureUpdatesEndTime) {
            try {
                if ([datetime]$settings.PauseFeatureUpdatesEndTime -gt (Get-Date)) { $held = $true }
            } catch {
                # 日時として読めない値は、保留の根拠にしない
                $null = $_
            }
        }
    }
    if ($held) { '大型更新は保留に設定' } else { '大型更新の保留の設定なし' }
}

# Windows 標準のウイルス対策が動いていなければ、ほかのウイルス対策ソフトの名前を読む
function ReadAntivirus {
    $standard = $null
    $standardFailure = $null
    try {
        $standard = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        $standardFailure = $_
    }
    if ($standard -and $standard.AntivirusEnabled -and "$($standard.AMRunningMode)" -notmatch 'Passive') {
        return 'Windows 標準のウイルス対策（有効）'
    }
    $others = @()
    try {
        # productState の 0x1000 のビットが、有効かどうかを表す
        $others = @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop |
            Where-Object { ($_.productState -band 0x1000) -ne 0 } |
            ForEach-Object { "$($_.displayName)（有効）" })
    } catch {
        if ($standardFailure) { throw $standardFailure }
    }
    if ($others.Count -gt 0) { return ($others -join '、') }
    if ($standardFailure) { throw $standardFailure }
    return 'Windows 標準のウイルス対策（無効）'
}

# ドメインとクラウドの参加を分けて判定する。クラウドの判定が読めなくても、ドメインの判定は残す
function ReadJoinType {
    $inDomain = (ReadCim 'Win32_ComputerSystem').PartOfDomain
    $inCloud = $false
    try {
        foreach ($line in @(dsregcmd /status)) {
            if ($line -match '^\s*AzureAdJoined\s*:\s*YES\s*$') { $inCloud = $true }
        }
    } catch {
        $null = $_
    }
    if ($inDomain -and $inCloud) { 'ドメインとクラウド参加' }
    elseif ($inCloud) { 'クラウド参加' }
    elseif ($inDomain) { 'ドメイン' }
    else { 'ワークグループ' }
}

# サインイン済みかどうかだけを判定する。メールアドレスなどの値そのものは記録しない
function ReadM365SignedIn {
    $identity = ReadRegistry 'HKCU:\SOFTWARE\Microsoft\Office\16.0\Common\Identity'
    $oneDrive = ReadRegistry 'HKCU:\SOFTWARE\Microsoft\OneDrive\Accounts\Business1'
    # どちらの記録もなければ、サインインしていないとは言い切れないので、取れなかった扱いにする
    if (-not $identity -and -not $oneDrive) { return $null }
    if ($identity.ADUserName -or $identity.ConnectedAccountWamAad -or $oneDrive.UserEmail) { return $true }
    return $false
}

Write-Host ''
Write-Host '調査しています。少し時間がかかることがあります。'

$pcName = $env:COMPUTERNAME
$collectedAt = (Get-Date).ToString("yyyy-MM-dd'T'HH':'mm':'sszzz", $invariant)

# ---- OS ----
CollectOne 'os' 'os.caption' { (CleanText (ReadCim 'Win32_OperatingSystem').Caption) -replace '^Microsoft\s+', '' }
CollectOne 'os' 'os.version' { CleanText (ReadCim 'Win32_OperatingSystem').Version }

# ---- 機器 ----
CollectOne 'hardware' 'hw.maker' { CleanText (ReadCim 'Win32_ComputerSystem').Manufacturer }
CollectOne 'hardware' 'hw.model' { CleanText (ReadCim 'Win32_ComputerSystem').Model }
CollectOne 'hardware' 'hw.memory_gb' { RoundGb (ReadCim 'Win32_ComputerSystem').TotalPhysicalMemory }
CollectOne 'hardware' 'disk.c_free_gb' {
    FloorGb (Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop).FreeSpace
}

# ---- ネットワーク ----
# ゲートウェイを持つ接続のうち、優先度がいちばん高いものを、この PC の接続とする
$adapter = $null
$adapterStatus = 'unavailable'
try {
    $adapter = Get-NetIPConfiguration -ErrorAction Stop |
        Where-Object { $_.IPv4DefaultGateway } |
        Sort-Object { @($_.IPv4DefaultGateway)[0].RouteMetric } |
        Select-Object -First 1
} catch {
    $adapterStatus = StatusFromError $_
}
if ($adapter) {
    CollectOne 'network' 'net.ip_mode' {
        $ipInterface = Get-NetIPInterface -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop
        if ("$($ipInterface.Dhcp)" -eq 'Enabled') { 'DHCP' } else { '固定' }
    }
    CollectOne 'network' 'net.gateway' { CleanText (@($adapter.IPv4DefaultGateway)[0].NextHop) }
    CollectOne 'network' 'net.dns' {
        @(Get-DnsClientServerAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop).ServerAddresses -join ', '
    }
} else {
    AddResult 'network' 'net.ip_mode' $null $adapterStatus
    AddResult 'network' 'net.gateway' $null $adapterStatus
    AddResult 'network' 'net.dns' $null $adapterStatus
}
CollectOne 'network' 'net.wifi_ssid' { ReadWifiName }

# ---- 共有フォルダ ----
# 読むのはこの PC の中の記録だけで、接続先の機器には問い合わせない
$drives = @{}
$shareFailure = $null
try {
    foreach ($mapping in @(Get-SmbMapping -ErrorAction Stop)) {
        if ("$($mapping.LocalPath)" -match '^([A-Za-z]):$' -and $mapping.RemotePath) {
            $drives[$Matches[1].ToUpperInvariant()] = "$($mapping.RemotePath)"
        }
    }
} catch {
    $shareFailure = StatusFromError $_
}
try {
    # 再起動後も残る設定のネットワーク ドライブの記録
    foreach ($remembered in @(Get-ItemProperty -Path 'HKCU:\Network\*' -ErrorAction Stop)) {
        if ("$($remembered.PSChildName)" -match '^[A-Za-z]$' -and $remembered.RemotePath) {
            $letter = "$($remembered.PSChildName)".ToUpperInvariant()
            if (-not $drives.ContainsKey($letter)) { $drives[$letter] = "$($remembered.RemotePath)" }
        }
    }
} catch {
    if (-not $shareFailure) { $shareFailure = StatusFromError $_ }
}
foreach ($letter in @($drives.Keys | Sort-Object)) {
    AddResult 'share' "share.drive.$letter" $drives[$letter] 'ok'
}
# 「共有フォルダがない」（0 件）と「読めなかった」を、この項目で区別する
if ($drives.Count -eq 0 -and $shareFailure) {
    AddResult 'share' 'share.drive_count' $null $shareFailure
} else {
    AddResult 'share' 'share.drive_count' ([int]$drives.Count) 'ok'
}

# ---- プリンター ----
$portAddress = @{}
try {
    foreach ($port in @(ReadCim 'Win32_TCPIPPrinterPort')) {
        if ($port.HostAddress) { $portAddress["$($port.Name)"] = "$($port.HostAddress)" }
    }
} catch {
    # 読めなくても、ポートの名前を接続先にして続ける
    $portAddress = @{}
}
try {
    # PDF への保存など、紙を出さない仮想のプリンターは除く
    $printers = @(Get-Printer -ErrorAction Stop |
        Where-Object { "$($_.PortName)" -notmatch '^(PORTPROMPT|nul|SHRFAX|XPSPort|FILE):$|!' } |
        Sort-Object Name)
    $index = 0
    foreach ($printer in $printers) {
        $portName = "$($printer.PortName)"
        $destination = $portName
        if ($portAddress.ContainsKey($portName)) { $destination = $portAddress[$portName] }
        $printerLabel = "$($printer.Name) $destination"
        AddResult 'printer' "printer.$index" $printerLabel 'ok'
        $index++
    }
} catch {
    # 番号は一覧の中の位置でしかないので、読めなかったことを 0 番に記録する
    AddResult 'printer' 'printer.0' $null (StatusFromError $_)
}

# ---- ソフト ----
# レジストリの Uninstall キーから、名前とバージョンだけを読む
$uninstallPaths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$softwareLabels = @{}
$softwareFailure = $null
foreach ($uninstallPath in $uninstallPaths) {
    try {
        # 壊れたキーが1つあっても残りを読めるよう、ここだけ Stop にしない
        $partErrors = $null
        $entries = @(Get-ItemProperty -Path $uninstallPath -ErrorAction SilentlyContinue -ErrorVariable partErrors)
        if ($partErrors -and -not $softwareFailure) { $softwareFailure = StatusFromError (@($partErrors)[0]) }
        foreach ($entry in $entries) {
            $name = CleanText $entry.DisplayName
            if ($name -eq '') { continue }
            # Windows の部品や、更新プログラムの記録は、ソフトの一覧に入れない
            if ($entry.SystemComponent -eq 1 -or $entry.ParentKeyName -or "$($entry.ReleaseType)" -match 'Update|Hotfix') { continue }
            $softwareVersion = CleanText $entry.DisplayVersion
            $softwareLabel = $name
            if ($softwareVersion -ne '' -and -not $name.Contains($softwareVersion)) { $softwareLabel = "$name $softwareVersion" }
            $softwareLabels[$softwareLabel] = $true
        }
    } catch {
        if (-not $softwareFailure) { $softwareFailure = StatusFromError $_ }
    }
}
$index = 0
foreach ($softwareLabel in @($softwareLabels.Keys | Sort-Object)) {
    AddResult 'software' "software.$index" $softwareLabel 'ok'
    $index++
}
if ($index -eq 0 -and $softwareFailure) {
    AddResult 'software' 'software.0' $null $softwareFailure
}

# ---- セキュリティ ----
CollectOne 'security' 'security.last_update' {
    $now = Get-Date
    $latest = @(Get-HotFix -ErrorAction Stop |
        Where-Object { $_.InstalledOn -and $_.InstalledOn -le $now } |
        Sort-Object InstalledOn -Descending |
        Select-Object -First 1)
    if ($latest.Count -gt 0) { $latest[0].InstalledOn.ToString('yyyy-MM-dd', $invariant) }
}
CollectOne 'security' 'security.feature_update' { ReadFeatureUpdate }
CollectOne 'security' 'security.antivirus' { ReadAntivirus }
CollectOne 'security' 'security.bitlocker' {
    $volume = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
    $protection = "$($volume.ProtectionStatus)"
    if ($protection -eq 'On') { '有効' } elseif ($protection -eq 'Off') { '無効' }
}

# ---- アカウント ----
CollectOne 'account' 'account.join_type' { ReadJoinType }
CollectOne 'account' 'account.m365_signed_in' { ReadM365SignedIn }

# ---- 保存 ----
# items は @() で包み、1件でも配列のままにする
$document = [ordered]@{
    schema_version = 1
    host = $pcName
    collected_at = $collectedAt
    items = @($results.ToArray())
}
$json = ConvertTo-Json -InputObject $document -Depth 5
$fileDate = $collectedAt.Substring(0, 10)
$outputPath = Join-Path (Get-Location).ProviderPath "hikitsugi-survey-$pcName-$fileDate.json"
try {
    [System.IO.File]::WriteAllText($outputPath, $json, [System.Text.UTF8Encoding]::new($false))
} catch {
    Write-Host ''
    Write-Host '結果を保存できませんでした。このフォルダには書き込めないようです。'
    Write-Host 'デスクトップなど、書き込めるフォルダに移動してから、もう一度実行してください。'
    exit 1
}

$okCount = @($results | Where-Object { $_.status -eq 'ok' }).Count
$deniedCount = @($results | Where-Object { $_.status -eq 'denied' }).Count
$unavailableCount = @($results | Where-Object { $_.status -eq 'unavailable' }).Count

Write-Host ''
Write-Host '調査が終わりました。結果を次のファイルに保存しました。'
Write-Host "  $outputPath"
Write-Host ''
Write-Host "読み取れた項目：$okCount 件"
Write-Host "権限がなくて読めなかった項目：$deniedCount 件"
Write-Host "この PC では読めなかった項目：$unavailableCount 件"
Write-Host '読めなかった項目があっても問題ありません。あとの質問で補います。'
Write-Host ''
Write-Host 'メモ帳でファイルを開いて、中身を確かめてから渡してください。'
Write-Host '渡したくない内容があれば、渡す前に相談してください。'
exit 0
