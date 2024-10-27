python -m pip install --upgrade pip
wait
pip install comfy-cli
wait
ls
cd assets
comfy --skip-prompt --here install --fast-deps --m-series --manager-url https://github.com/Comfy-Org/manager-core
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
echo Sign Libs and Bins
cd python2/python/
filelist=("lib/libpython3.12.dylib" "lib/python3.12/lib-dynload/_crypt.cpython-312-darwin.so" "bin/uv" "bin/uvx" "bin/python3.12")
for file in ${filelist[@]}; do codesign --sign "Developer ID Application: Drip Artificial Inc" --force --timestamp --options runtime --entitlements ../../../scripts/entitlements.mac.plist "$file"; done
echo Rezip
cd ../..
mv python python3 
mv python2/python python
tar -czf python.tgz python/
rm -rf python2
rm -rf python3
rm -rf python
ls