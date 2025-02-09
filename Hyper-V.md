## Windows development: Hyper-V

ComfyUI desktop can be built and tested in using a Hyper-V VM. This document convers configuration of **CPU mode** only.

### Requirements

- 32GB RAM
- A Windows install ISO
- Local admin
- Check the summary on the [official install process](https://learn.microsoft.com/virtualization/hyper-v-on-windows/quick-start/enable-hyper-v#check-requirements) or the [system requirements page](https://learn.microsoft.com/virtualization/hyper-v-on-windows/reference/hyper-v-requirements) for full details.

### Enabling

Enable Hyper-V using the PowerShell command (reboot required):

```ps1
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

Source: [Microsoft documentation](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/quick-start/enable-hyper-v#enable-hyper-v-using-powershell)

### Configure a VM

A quick-start script to create a VM. For full details, see [Create a virtual machine with Hyper-V on Windows](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/quick-start/create-virtual-machine).

Minimum recommended configuration is:

- Generation 2
- 16GB RAM
- 100GB virtual HDD

Commands must be run as administrator.

```ps1
# Path to Windows install ISO
$InstallMedia = 'C:\Users\User\Downloads\win11.iso'

# Location where VM files will be stored
$RootPath = 'D:\Virtual Machines'

# VM config
$VMName = 'comfyui'
$RAM = 16
$HDD = 100
$VirtualCPUs = 6

# Required for Windows 11
$UseVirtualTPM = $true

# Switch name - if unsure, do not change
$Switch = 'Default Switch'

#
# End VM config
#

$GBtoBytes = 1024 * 1024 * 1024
$RAM *= $GBtoBytes
$HDD *= $GBtoBytes

# Create New Virtual Machine
New-VM -Name $VMName -MemoryStartupBytes $RAM -Generation 2 -NewVHDPath "$RootPath\$VMName\$VMName.vhdx" -NewVHDSizeBytes $HDD -Path "$RootPath\$VMName" -SwitchName $Switch

# Add DVD Drive to Virtual Machine
Add-VMScsiController -VMName $VMName
Add-VMDvdDrive -VMName $VMName -ControllerNumber 1 -ControllerLocation 0 -Path $InstallMedia

# Mount Installation Media
$DVDDrive = Get-VMDvdDrive -VMName $VMName

# Configure Virtual Machine to Boot from DVD
Set-VMFirmware -VMName $VMName -FirstBootDevice $DVDDrive -EnableSecureBoot On

# Enable virtual TPM
Set-VMKeyProtector -VMName $VMName -NewLocalKeyProtector
Enable-VMTPM -VMName $VMName

# Number of virtual processors to expose
Set-VMProcessor -VMName $VMName -Count $VirtualCPUs
```

### Connect to the VM

Use the Hyper-V GUI to connect to the VM, or as an Administrator:

```ps1
vmconnect.exe localhost comfyui
```

### Install Windows

1. Install & update Windows, and configure to your liking.
1. From outside the VM, take a snapshot via the Hyper-V GUI or as admin in PowerShell:

```ps1
Checkpoint-VM -Name $VMName -SnapshotName "Base VM configured and updated"
```

### Checkpoints

- Take checkpoints before making major changes
- If taken when a VM is shut down, a checkpoint is extremely fast and takes almost no space
  - Instead of backing up the entire drive, a checkpoint simply stops writing changes to the virtual drive file. Instead, a new file is created next to it, and differences to the original disk are saved there.
- Applying a checkpoint completely resets the hard drive to the exact condition it was in before

### Ready to code

- Copy & paste both files & code between the VM and host OS
- Proceed with normal dev documentation
- Remember to use `--cpu` when launching ComfyUI
- Don't forget to take checkpoints!
- Common pitfall: avoid opening `.vhdx` files in Windows Explorer (simply opening it once can prevent a VM from starting, requiring manual repair)

### Restoring checkpoints

GUI is strongly recommended when applying checkpoints. If you need the command line:

```ps1
Restore-VMCheckpoint -VMName $VMName -Name "Insert 'SnapshotName' Here"
```
