#!/usr/bin/env python3
"""
UV Download Timeline Analyzer
Analyzes parallel downloads in UV pip install debug output
"""

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import sys

@dataclass
class DownloadEvent:
    """Represents a download event"""
    timestamp: float
    line_num: int
    package: str
    event_type: str  # 'start', 'data', 'end'
    stream_id: int
    size_mb: Optional[float] = None
    
@dataclass
class PackageDownload:
    """Tracks a complete package download"""
    package: str
    stream_id: int
    start_time: float
    start_line: int
    end_time: Optional[float] = None
    end_line: Optional[int] = None
    size_mb: Optional[float] = None
    data_frames: int = 0
    
    @property
    def duration_ms(self) -> Optional[float]:
        if self.end_time is not None:
            return (self.end_time - self.start_time) * 1000
        return None
    
    @property
    def speed_mbps(self) -> Optional[float]:
        if self.duration_ms and self.size_mb:
            return (self.size_mb * 8) / (self.duration_ms / 1000)
        return None

class UVDownloadAnalyzer:
    """Analyzes UV download patterns and timing"""
    
    def __init__(self):
        self.events: List[DownloadEvent] = []
        self.downloads: Dict[int, PackageDownload] = {}
        self.stream_to_package: Dict[int, str] = {}
        
    def parse_timestamp(self, line: str) -> Optional[float]:
        """Extract timestamp from log line"""
        match = re.match(r'^\s*([0-9.]+)s', line)
        if match:
            return float(match.group(1))
        return None
    
    def parse_line(self, line_num: int, line: str):
        """Parse a single log line for download events"""
        timestamp = self.parse_timestamp(line)
            
        # Check for download start with size (no timestamp on this line)
        download_match = re.search(r'Downloading (\w+) \(([0-9.]+)MiB\)', line)
        if download_match:
            package = download_match.group(1)
            size_mb = float(download_match.group(2))
            
            # Find the stream ID from previous lines (Headers frame)
            # Look for the most recent stream assignment
            stream_id = self._find_stream_for_package(package, line_num)
            if stream_id:
                self.stream_to_package[stream_id] = package
                # We'll update the timestamp when we see the first data frame
                download = PackageDownload(
                    package=package,
                    stream_id=stream_id,
                    start_time=0.0,  # Will be updated
                    start_line=line_num,
                    size_mb=size_mb
                )
                self.downloads[stream_id] = download
        
        if not timestamp:
            return
        
        # Check for data frames
        data_match = re.search(r'frame=Data \{ stream_id: StreamId\((\d+)\)', line)
        if data_match:
            stream_id = int(data_match.group(1))
            if stream_id in self.downloads:
                download = self.downloads[stream_id]
                
                # Set start time on first data frame
                if download.start_time == 0.0:
                    download.start_time = timestamp
                    self.events.append(DownloadEvent(
                        timestamp=timestamp,
                        line_num=line_num,
                        package=download.package,
                        event_type='start',
                        stream_id=stream_id,
                        size_mb=download.size_mb
                    ))
                
                if not download.end_time:
                    download.data_frames += 1
                
                # Check for END_STREAM flag
                if 'END_STREAM' in line:
                    download.end_time = timestamp
                    download.end_line = line_num
                    self.events.append(DownloadEvent(
                        timestamp=timestamp,
                        line_num=line_num,
                        package=download.package,
                        event_type='end',
                        stream_id=stream_id
                    ))
    
    def _find_stream_for_package(self, package: str, line_num: int) -> Optional[int]:
        """Find stream ID for a package based on context"""
        # Based on our analysis:
        # torch -> StreamId(7)
        # numpy -> StreamId(11) 
        # scipy -> StreamId(9)
        
        # This is a simplification - in production, we'd look back through recent lines
        # to find the Headers frame with the matching URL
        package_streams = {
            'torch': 7,
            'numpy': 11,
            'scipy': 9
        }
        return package_streams.get(package.lower())
    
    def analyze_file(self, filename: str):
        """Analyze a UV debug output file"""
        with open(filename, 'r') as f:
            for line_num, line in enumerate(f, 1):
                self.parse_line(line_num, line)
    
    def get_timeline(self) -> str:
        """Generate a timeline visualization"""
        output = []
        output.append("="*80)
        output.append("UV PARALLEL DOWNLOAD TIMELINE ANALYSIS")
        output.append("="*80)
        output.append("")
        
        # Sort downloads by start time
        sorted_downloads = sorted(self.downloads.values(), key=lambda d: d.start_time)
        
        if not sorted_downloads:
            output.append("No downloads found in log file")
            return "\n".join(output)
        
        # Overall statistics
        first_start = min(d.start_time for d in sorted_downloads)
        last_end = max(d.end_time for d in sorted_downloads if d.end_time)
        total_duration = (last_end - first_start) * 1000
        
        output.append(f"Total download phase duration: {total_duration:.1f}ms")
        output.append(f"Number of parallel downloads: {len(sorted_downloads)}")
        output.append("")
        
        # Individual download details
        output.append("PACKAGE DOWNLOAD DETAILS:")
        output.append("-" * 60)
        
        for download in sorted_downloads:
            output.append(f"\n{download.package.upper()}")
            output.append(f"  Stream ID: {download.stream_id}")
            output.append(f"  Size: {download.size_mb:.1f} MiB")
            output.append(f"  Start: {download.start_time:.3f}s (line {download.start_line})")
            
            if download.end_time:
                output.append(f"  End: {download.end_time:.3f}s (line {download.end_line})")
                output.append(f"  Duration: {download.duration_ms:.1f}ms")
                output.append(f"  Data frames: {download.data_frames}")
                if download.speed_mbps:
                    output.append(f"  Speed: {download.speed_mbps:.1f} Mbps")
            else:
                output.append(f"  Status: INCOMPLETE")
        
        # Timeline visualization
        output.append("\n" + "="*60)
        output.append("PARALLEL DOWNLOAD TIMELINE (ASCII):")
        output.append("-" * 60)
        
        # Create ASCII timeline
        timeline_width = 50
        for download in sorted_downloads:
            if not download.end_time:
                continue
                
            rel_start = (download.start_time - first_start) / (last_end - first_start)
            rel_end = (download.end_time - first_start) / (last_end - first_start)
            
            start_pos = int(rel_start * timeline_width)
            end_pos = int(rel_end * timeline_width)
            
            timeline = ['.'] * timeline_width
            for i in range(start_pos, min(end_pos + 1, timeline_width)):
                timeline[i] = '='
            timeline[start_pos] = '['
            if end_pos < timeline_width:
                timeline[end_pos] = ']'
            
            output.append(f"{download.package:8} {''.join(timeline)} {download.duration_ms:.0f}ms")
        
        output.append("-" * 60)
        output.append(f"Timeline: [{first_start:.2f}s - {last_end:.2f}s]")
        
        # Parallelism analysis
        output.append("\n" + "="*60)
        output.append("PARALLELISM ANALYSIS:")
        output.append("-" * 60)
        
        # Find overlapping periods
        overlaps = []
        for i, d1 in enumerate(sorted_downloads):
            for d2 in sorted_downloads[i+1:]:
                if d1.end_time and d2.end_time:
                    # Check if they overlap
                    if d1.start_time < d2.end_time and d2.start_time < d1.end_time:
                        overlap_start = max(d1.start_time, d2.start_time)
                        overlap_end = min(d1.end_time, d2.end_time)
                        overlap_duration = (overlap_end - overlap_start) * 1000
                        overlaps.append((d1.package, d2.package, overlap_duration))
        
        if overlaps:
            output.append("Overlapping downloads:")
            for pkg1, pkg2, duration in overlaps:
                output.append(f"  {pkg1} & {pkg2}: {duration:.1f}ms overlap")
        else:
            output.append("No overlapping downloads detected")
        
        # Calculate effective parallelism
        max_parallel = 0
        current_parallel = 0
        events_sorted = sorted(self.events, key=lambda e: e.timestamp)
        
        for event in events_sorted:
            if event.event_type == 'start':
                current_parallel += 1
                max_parallel = max(max_parallel, current_parallel)
            elif event.event_type == 'end':
                current_parallel -= 1
        
        output.append(f"\nMaximum concurrent downloads: {max_parallel}")
        
        return "\n".join(output)


def main():
    """Main entry point"""
    if len(sys.argv) > 1:
        filename = sys.argv[1]
    else:
        filename = "/tmp/uv_debug_output.log"
    
    analyzer = UVDownloadAnalyzer()
    
    try:
        analyzer.analyze_file(filename)
        print(analyzer.get_timeline())
    except FileNotFoundError:
        print(f"File not found: {filename}")
        print("Usage: python uv-download-analyzer.py [uv_output_file]")
        sys.exit(1)


if __name__ == "__main__":
    main()