#!/usr/bin/env bash
set -e

# Decode the base64 encoded certificate
echo $CERTIFICATE_OSX_APPLICATION | base64 --decode > certificate.p12

# Create a keychain
security create-keychain -p "$CERTIFICATE_PASSWORD" build.keychain

# Make the custom keychain default, so xcodebuild will use it for signing
security default-keychain -s build.keychain

# Unlock the keychain
security unlock-keychain -p "$CERTIFICATE_PASSWORD" build.keychain

# Add certificates to keychain and allow codesign to access them
security import certificate.p12 -k build.keychain -P "$CERTIFICATE_PASSWORD" -T /usr/bin/codesign

security set-key-partition-list -S apple-tool:,apple: -s -k "$CERTIFICATE_PASSWORD" build.keychain

# Remove the temporary certificate file
rm certificate.p12
