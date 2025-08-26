#!/usr/bin/env python3
"""
UV pip install Stage Parser
Correctly parses UV debug output to identify installation stages based on documented patterns
"""

import re
from enum import Enum
from typing import List, Tuple, Optional

class UVStage(Enum):
    """Major stages of UV pip install process (11 stages as documented)"""
    INITIALIZING = "initializing"
    STARTUP = "startup"
    RESOLUTION_SETUP = "resolution_setup"
    CACHE_CHECKING_AND_METADATA = "cache_checking_and_metadata"
    DEPENDENCY_RESOLUTION = "dependency_resolution"
    RESOLUTION_SUMMARY = "resolution_summary"
    INSTALLATION_PLANNING = "installation_planning"
    PACKAGE_DOWNLOADS = "package_downloads"
    PACKAGE_PREPARATION = "package_preparation"
    INSTALLATION = "installation"
    FINAL_SUMMARY = "final_summary"

class UVStageParser:
    """Parses UV output line by line to determine current stage"""
    
    def __init__(self):
        self.current_stage = UVStage.INITIALIZING
        self.stage_history: List[Tuple[UVStage, str]] = []
        self.packages_resolved = 0
        self.packages_prepared = 0
        self.packages_installed = 0
        self.seen_first_pubgrub_decision = False
        
    def parse_line(self, line: str) -> Optional[UVStage]:
        """Parse a single line and update stage if necessary"""
        
        # Store previous stage for comparison
        prev_stage = self.current_stage
        
        # Stage 1 -> 2: Startup (UV version announcement)
        if self.current_stage == UVStage.INITIALIZING:
            # Pattern: DEBUG uv uv X.X.X (hash date)
            if re.search(r'^\s+[\d.]+\w+\s+DEBUG\s+uv\s+uv\s+[\d.]+\s+\([a-f0-9]+\s+\d{4}-\d{2}-\d{2}\)', line):
                self.current_stage = UVStage.STARTUP
                
        # Stage 2 -> 3: Resolution Setup
        elif self.current_stage == UVStage.STARTUP:
            # Pattern: "Solving with installed Python version: X.X.X"
            if re.search(r'DEBUG\s+uv_resolver::resolver\s+Solving\s+with\s+installed\s+Python\s+version:\s+[\d.]+', line):
                self.current_stage = UVStage.RESOLUTION_SETUP
                
        # Stage 3 -> 4: Cache Checking and Metadata Retrieval
        elif self.current_stage == UVStage.RESOLUTION_SETUP:
            # Two paths:
            # Path A: Cache hit - "Found fresh response for"
            if re.search(r'DEBUG\s+uv_client::cached_client\s+Found\s+fresh\s+response\s+for:\s+https://pypi\.org/simple/\w+/', line):
                self.current_stage = UVStage.CACHE_CHECKING_AND_METADATA
            # Path B: Cache miss - parse_simple_api indicates metadata download
            elif re.search(r'uv_client::registry_client::parse_simple_api\s+package=\w+', line):
                self.current_stage = UVStage.CACHE_CHECKING_AND_METADATA
                
        # Stage 4 -> 5: Dependency Resolution (First real package decision)
        elif self.current_stage == UVStage.CACHE_CHECKING_AND_METADATA:
            # Pattern: First PubGrub decision for package ID != 0
            if re.search(r'INFO\s+pubgrub::internal::partial_solution\s+add_decision:\s+Id::<PubGrubPackage>\((\d+)\)', line):
                match = re.search(r'Id::<PubGrubPackage>\((\d+)\)', line)
                if match and int(match.group(1)) != 0:
                    if not self.seen_first_pubgrub_decision:
                        self.seen_first_pubgrub_decision = True
                        self.current_stage = UVStage.DEPENDENCY_RESOLUTION
                
        # Stage 5 -> 6: Resolution Summary
        elif self.current_stage == UVStage.DEPENDENCY_RESOLUTION:
            # Pattern: "Resolved N packages in Xms"
            if re.search(r'^Resolved\s+\d+\s+packages?\s+in\s+[\d.]+\w+', line):
                match = re.search(r'Resolved\s+(\d+)\s+packages?', line)
                if match:
                    self.packages_resolved = int(match.group(1))
                self.current_stage = UVStage.RESOLUTION_SUMMARY
                
        # Stage 6 -> 7: Installation Planning
        elif self.current_stage == UVStage.RESOLUTION_SUMMARY:
            # Pattern: First uv_installer::plan message
            if re.search(r'DEBUG\s+uv_installer::plan\s+(Registry requirement|Requirement|Identified|Unnecessary)', line):
                self.current_stage = UVStage.INSTALLATION_PLANNING
                
        # Stage 7 -> 8: Package Downloads (only if uncached packages exist)
        elif self.current_stage == UVStage.INSTALLATION_PLANNING:
            # Pattern: "uv_installer::preparer::prepare total=N"
            if re.search(r'uv_installer::preparer::prepare\s+total=\d+', line):
                self.current_stage = UVStage.PACKAGE_DOWNLOADS
            # Or if we see install_blocking directly (no downloads needed)
            elif re.search(r'uv_installer::installer::install_blocking\s+num_wheels=\d+', line):
                self.current_stage = UVStage.INSTALLATION
                
        # Stage 8 -> 9: Package Preparation (after downloads complete)
        elif self.current_stage == UVStage.PACKAGE_DOWNLOADS:
            # Pattern: "Prepared N packages in X.XXs"
            if re.search(r'^Prepared\s+\d+\s+packages?\s+in\s+[\d.]+\w+', line):
                match = re.search(r'Prepared\s+(\d+)\s+packages?', line)
                if match:
                    self.packages_prepared = int(match.group(1))
                self.current_stage = UVStage.PACKAGE_PREPARATION
                
        # Stage 9 -> 10: Installation
        elif self.current_stage == UVStage.PACKAGE_PREPARATION:
            # Pattern: "uv_installer::installer::install_blocking num_wheels=N"
            if re.search(r'uv_installer::installer::install_blocking\s+num_wheels=\d+', line):
                self.current_stage = UVStage.INSTALLATION
                
        # Stage 10 -> 11: Final Summary
        elif self.current_stage == UVStage.INSTALLATION:
            # Pattern: "Installed N packages in Xms"
            if re.search(r'^Installed\s+\d+\s+packages?\s+in\s+[\d.]+\w+', line):
                match = re.search(r'Installed\s+(\d+)\s+packages?', line)
                if match:
                    self.packages_installed = int(match.group(1))
                self.current_stage = UVStage.FINAL_SUMMARY
        
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
            summary += f"{i:2}. {stage.value:30} <- {trigger}\n"
        
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