python -m pip install --upgrade pip >/dev/null
wait
pip install comfy-cli >/dev/null
wait
ls
cd assets
comfy --skip-prompt --here install --fast-deps --m-series --manager-url https://github.com/Comfy-Org/manager-core >/dev/null
wait
cd ComfyUI
cd .. 
comfy --here standalone --platform macos
wait
comfy standalone --rehydrate
wait
rm -rf ComfyUI/custom_nodes/ComfyUI-Manager/.git
mkdir python2/
tar -xzf python.tgz -C python2/
rm python.tgz
find . -type l ! -exec test -e {} \; -delete
wait
find . -name '*.tar.gz' -delete
wait
ls
echo Sign Libs and Bins
mv python python3 
mv python2/python python
mkdir output
rm -rf python2
rm -rf python3
cd python
filelist=("lib/libpython3.12.dylib" "lib/python3.12/lib-dynload/_crypt.cpython-312-darwin.so" "bin/uv" "bin/uvx" "bin/python3.12")
for file in ${filelist[@]}; do mkdir -p `dirname ../output/$file` && mv "$file" ../output/; done
cd ..
echo Rezip
tar -czf python.tgz python/
rm -rf python