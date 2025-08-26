#!/usr/bin/env python3
"""
UV pip install Stage Parser
Parses UV debug output to identify installation stages
"""

import re
from enum import Enum
from typing import List, Tuple, Optional

class UVStage(Enum):
    """Major stages of UV pip install process"""
    INITIALIZING = "initializing"
    STARTUP = "startup"
    RESOLUTION_SETUP = "resolution_setup"
    CACHE_CHECKING = "cache_checking"
    METADATA_DOWNLOAD = "metadata_download"
    DEPENDENCY_RESOLUTION = "dependency_resolution"
    RESOLUTION_SUMMARY = "resolution_summary"
    INSTALLATION_PLANNING = "installation_planning"
    PACKAGE_DOWNLOADS = "package_downloads"
    DOWNLOAD_COMPLETION = "download_completion"
    PACKAGE_PREPARATION = "package_preparation"
    INSTALLATION = "installation"
    FINAL_SUMMARY = "final_summary"
    COMPLETE = "complete"

class UVStageParser:
    """Parses UV output line by line to determine current stage"""
    
    def __init__(self):
        self.current_stage = UVStage.INITIALIZING
        self.stage_history: List[Tuple[UVStage, str]] = []
        self.packages_resolved = 0
        self.packages_prepared = 0
        self.packages_installed = 0
        
    def parse_line(self, line: str) -> Optional[UVStage]:
        """Parse a single line and update stage if necessary"""
        
        # Store previous stage for comparison
        prev_stage = self.current_stage
        
        # Stage detection patterns
        if self.current_stage == UVStage.INITIALIZING:
            if "uv uv" in line and "DEBUG" in line:
                self.current_stage = UVStage.STARTUP
                
        elif self.current_stage == UVStage.STARTUP:
            if "Searching for default Python interpreter" in line:
                pass  # Still in startup
            elif "Using Python" in line and "environment" in line:
                pass  # Still in startup
            elif "Solving with installed Python version" in line:
                self.current_stage = UVStage.RESOLUTION_SETUP
                
        elif self.current_stage == UVStage.RESOLUTION_SETUP:
            if "Adding direct dependency" in line:
                pass  # Still in resolution setup
            elif "No cache entry for" in line and "simple" in line:
                self.current_stage = UVStage.CACHE_CHECKING
                
        elif self.current_stage == UVStage.CACHE_CHECKING:
            if "starting new connection" in line:
                pass  # Still cache checking/network init
            elif "connected to" in line:
                pass  # Still establishing connections
            elif "parse_simple_api" in line or "registry_client::parse_simple_api" in line:
                self.current_stage = UVStage.METADATA_DOWNLOAD
                
        elif self.current_stage == UVStage.METADATA_DOWNLOAD:
            if "parse_simple_api" in line:
                pass  # Still downloading metadata
            elif "parse_metadata21" in line:
                pass  # Still parsing metadata
            elif "pubgrub::internal::partial_solution add_decision" in line:
                self.current_stage = UVStage.DEPENDENCY_RESOLUTION
                
        elif self.current_stage == UVStage.DEPENDENCY_RESOLUTION:
            if "Searching for a compatible version" in line:
                pass  # Still resolving
            elif "Selecting:" in line:
                pass  # Still resolving
            elif re.search(r"Resolved \d+ packages in \d+ms", line):
                match = re.search(r"Resolved (\d+) packages", line)
                if match:
                    self.packages_resolved = int(match.group(1))
                self.current_stage = UVStage.RESOLUTION_SUMMARY
                
        elif self.current_stage == UVStage.RESOLUTION_SUMMARY:
            if "Identified uncached distribution" in line:
                self.current_stage = UVStage.INSTALLATION_PLANNING
            elif "Requirement already installed" in line:
                self.current_stage = UVStage.INSTALLATION_PLANNING
                
        elif self.current_stage == UVStage.INSTALLATION_PLANNING:
            if "Downloading" in line and not "frame=Data" in line:
                self.current_stage = UVStage.PACKAGE_DOWNLOADS
            elif "preparer::prepare" in line:
                self.current_stage = UVStage.PACKAGE_DOWNLOADS
            elif "preparer::get_wheel" in line:
                self.current_stage = UVStage.PACKAGE_DOWNLOADS
                
        elif self.current_stage == UVStage.PACKAGE_DOWNLOADS:
            if "frame=Data { stream_id" in line:
                pass  # Still downloading
            elif re.search(r"Prepared \d+ packages? in [\d.]+s", line):
                match = re.search(r"Prepared (\d+) packages?", line)
                if match:
                    self.packages_prepared = int(match.group(1))
                self.current_stage = UVStage.PACKAGE_PREPARATION
                
        elif self.current_stage == UVStage.PACKAGE_PREPARATION:
            if "installer::install" in line:
                self.current_stage = UVStage.INSTALLATION
                
        elif self.current_stage == UVStage.INSTALLATION:
            if "install_wheel wheel=" in line:
                pass  # Still installing
            elif re.search(r"Installed \d+ packages? in \d+ms", line):
                match = re.search(r"Installed (\d+) packages?", line)
                if match:
                    self.packages_installed = int(match.group(1))
                self.current_stage = UVStage.FINAL_SUMMARY
                
        elif self.current_stage == UVStage.FINAL_SUMMARY:
            if line.strip().startswith("+"):
                pass  # Reading package list
            else:
                self.current_stage = UVStage.COMPLETE
        
        # Record stage change
        if prev_stage != self.current_stage:
            self.stage_history.append((self.current_stage, line))
            return self.current_stage
        
        return None
    
    def get_stage_summary(self) -> str:
        """Get a summary of stages encountered"""
        summary = f"UV Installation Stage Summary\n"
        summary += f"=" * 40 + "\n"
        summary += f"Total stages encountered: {len(self.stage_history)}\n"
        summary += f"Packages resolved: {self.packages_resolved}\n"
        summary += f"Packages prepared: {self.packages_prepared}\n"
        summary += f"Packages installed: {self.packages_installed}\n\n"
        
        summary += "Stage progression:\n"
        for i, (stage, trigger_line) in enumerate(self.stage_history, 1):
            # Truncate trigger line for display
            trigger = trigger_line.strip()[:80] + "..." if len(trigger_line) > 80 else trigger_line.strip()
            summary += f"{i:2}. {stage.value:25} <- {trigger}\n"
        
        return summary


def main():
    """Demo: Parse UV output file and identify stages"""
    import sys
    
    # Use test output file or stdin
    if len(sys.argv) > 1:
        filename = sys.argv[1]
    else:
        filename = "/tmp/uv_debug_output.log"
    
    parser = UVStageParser()
    
    try:
        with open(filename, 'r') as f:
            for line_num, line in enumerate(f, 1):
                new_stage = parser.parse_line(line)
                if new_stage:
                    print(f"Line {line_num:5}: Stage changed to {new_stage.value}")
    except FileNotFoundError:
        print(f"File not found: {filename}")
        print("Usage: python uv-stage-parser.py [uv_output_file]")
        sys.exit(1)
    
    print("\n" + parser.get_stage_summary())


if __name__ == "__main__":
    main()