#!/usr/bin/env bash
# Voice fallback on a Linux server: whisper.cpp (CPU) + small and base models.
# The mainframe runs it per file only when the Mac's whisper is away (src/voice.js).
set -e
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null && command -v cmake >/dev/null && command -v g++ >/dev/null || sudo apt-get install -y -q ffmpeg cmake g++ git
if [ ! -x vendor/whisper.cpp/build/bin/whisper-cli ]; then
  TAG=$(git ls-remote --tags --refs https://github.com/ggml-org/whisper.cpp 'v1.*' | awk -F/ '{print $3}' | sort -V | tail -1)
  rm -rf vendor/whisper.cpp && mkdir -p vendor
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp vendor/whisper.cpp
  cmake -S vendor/whisper.cpp -B vendor/whisper.cpp/build -Wno-dev -DCMAKE_BUILD_TYPE=Release -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF >/dev/null
  nice cmake --build vendor/whisper.cpp/build -j "$(nproc)" --target whisper-cli
fi
mkdir -p data/models
for m in small-q5_1 base-q5_1; do
  [ -s "data/models/ggml-$m.bin" ] || curl -fsSL -o "data/models/ggml-$m.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$m.bin"
done
echo "Готово: расшифровка голосовых на сервере включится сама, когда Mac недоступен."
