# Now to generate uv output to parse

```bash
# 1. Reset environment BEFORE generating test output.
cd ~/Documents/ComfyUI && uv pip uninstall torch numpy scipy --quiet && uv cache clean --quiet
# 2. Run the test! The output of this process should be recorded.
cd ~/Documents/ComfyUI && UV_LOG_CONTEXT=1 RUST_LOG=debug uv pip install numpy torch scipy
```

- DO NOT alter the reset command! Run the reset command EXACTLY as is, immediately before running the output command.
- The output of step 2 is the part that must be fed into the parser.
- Save the output to disk for future use
- You should use pre-recorded output as a "simulation" for testing.
  - Do not partially mock this; you should always test by using the full output log.
- The process will output thousands of lines. Do not `tee` or `head` the process output! Just write it ALL to a file.
