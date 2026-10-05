# Lists Recycle Bin entries whose name starts with the given prefix, with the folder they came from.
param([string]$Prefix = 'a (2)')
$bin = (New-Object -ComObject Shell.Application).NameSpace(10)
foreach ($item in $bin.Items()) {
  if ($item.Name -like "$Prefix*") {
    "{0} | from {1}" -f $item.Name, $bin.GetDetailsOf($item, 1)
  }
}
