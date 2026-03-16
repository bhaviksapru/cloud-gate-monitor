# cloud-gate-monitor

https://bhaviksapru.github.io/


Home CCTV + gate monitoring — Raspberry Pi · TAPO C100 · TTLock → AWS

**What it does**
- Streams RTSP from TAPO cameras → S3 → CloudFront (live HLS + 7-day recorded clips)
- Receives TTLock gate events → DynamoDB → SMS alert after N failed attempts
- React dashboard behind Cognito (TOTP MFA, invite-only)
- Pi uses IoT X.509 certificate for AWS access — no IAM keys on device

**Cost**
| Cameras | Monthly cost |
|---------|-------------|
| 1 | ~$1.50 |
| 2 | ~$2.80 |
| 4 | ~$5.50 |

Reference Architecture-http://bhaviksapru.github.io/cloud-gate-monitor/architecture/aws-reference-architecture.html

Sequence Diagram-https://bhaviksapru.github.io/cloud-gate-monitor/architecture/sequence-diagram.html

Financial Analysis-https://bhaviksapru.github.io/cloud-gate-monitor/architecture/financial-analysis.html


---

## Prerequisites

- AWS CLI v2 configured (`aws configure`)
- SAM CLI — `brew install aws-sam-cli`
- Node.js 20 — `brew install node`

---

## 1. Configure

Edit `samconfig.toml` and fill in your values:

```toml
parameter_overrides = """
  AlertPhoneNumber=+14165551234
  FailedAttemptThreshold=1
  FailedAttemptWindowMinutes=60
  TTLockClientSecret=YOUR_TTLOCK_WEBHOOK_SECRET
"""
```

---

## 2. Deploy AWS infrastructure

```bash
# Install Lambda dependencies
for dir in functions/*/; do (cd "$dir" && npm ci); done

# Build TypeScript (esbuild — no Docker needed)
sam build

# Deploy (creates S3, CloudFront, Cognito, API Gateway, Lambda x3, DynamoDB, IoT)
sam deploy
```

Save the outputs — you need them in the next steps:

```bash
aws cloudformation describe-stacks \
  --stack-name cloud-gate-monitor \
  --query "Stacks[0].Outputs" \
  --output table
```

---

## 3. Build and deploy the dashboard

```bash
cd dashboard

VITE_COGNITO_DOMAIN=<CognitoDomain from outputs> \
VITE_COGNITO_CLIENT_ID=<UserPoolClientId from outputs> \
VITE_API_BASE_URL=<ApiURL from outputs> \
VITE_CF_DOMAIN=<DashboardURL from outputs, without https://> \
  npm ci && npm run build

cd ..

BUCKET=$(aws cloudformation describe-stacks \
  --stack-name cloud-gate-monitor \
  --query "Stacks[0].Outputs[?OutputKey=='VideoBucket'].OutputValue" \
  --output text)

# Note: vite.config.ts sets outDir to ../dist (project root), so build output
# lands at dist/ relative to the project root after `cd ..`
aws s3 sync dist/ "s3://$BUCKET/" \
  --delete --cache-control "public,max-age=31536000,immutable" --exclude "index.html"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate"
```

---

## 4. Create your login

```bash
POOL=$(aws cloudformation describe-stacks \
  --stack-name cloud-gate-monitor \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" \
  --username you@example.com \
  --temporary-password 'Temp$1234abcd!' \
  --message-action SUPPRESS
```

Open the `DashboardURL` from outputs. On first login Cognito prompts you to set a permanent password and enroll a TOTP authenticator (Google Authenticator, 1Password, etc).

---

## 5. Provision the Raspberry Pi

**Run from your laptop** (requires AWS credentials):

```bash
REGION=ca-central-1

# Create IoT certificate
CERT=$(aws iot create-keys-and-certificate --set-as-active --region $REGION)
CERT_ARN=$(echo "$CERT" | python3 -c "import sys,json; print(json.load(sys.stdin)['certificateArn'])")
echo "$CERT" | python3 -c "import sys,json; print(json.load(sys.stdin)['certificatePem'])"       > device.crt
echo "$CERT" | python3 -c "import sys,json; print(json.load(sys.stdin)['keyPair']['PrivateKey'])" > device.key
curl -fsSL https://www.amazontrust.com/repository/AmazonRootCA1.pem -o AmazonRootCA1.pem

# Attach to Thing and Policy
aws iot attach-thing-principal --thing-name cgm-pi    --principal "$CERT_ARN" --region $REGION
aws iot attach-policy          --policy-name cgm-pi-policy --target "$CERT_ARN" --region $REGION

# Get endpoints
aws iot describe-endpoint --endpoint-type iot:CredentialProvider --region $REGION --query endpointAddress --output text
```

**Copy certs to the Pi:**

```bash
PI=pi@192.168.1.X

ssh $PI "sudo mkdir -p /etc/cgm/certs && sudo useradd -r -s /bin/false cgm 2>/dev/null; true"
scp device.crt device.key AmazonRootCA1.pem $PI:/tmp/
ssh $PI "sudo mv /tmp/device.crt /tmp/device.key /tmp/AmazonRootCA1.pem /etc/cgm/certs/ \
      && sudo chmod 600 /etc/cgm/certs/* && sudo chown -R cgm:cgm /etc/cgm"
```

**On the Pi — create `/etc/cgm/cgm.env`** (fill in your values):

```bash
sudo tee /etc/cgm/cgm.env > /dev/null << 'EOF'
AWS_REGION=ca-central-1
VIDEO_BUCKET=cgm-video-YOUR_ACCOUNT_ID
IOT_CRED_ENDPOINT=XXXX.credentials.iot.ca-central-1.amazonaws.com
IOT_ROLE_ALIAS=cgm-pi-alias
CERT_PATH=/etc/cgm/certs/device.crt
KEY_PATH=/etc/cgm/certs/device.key
CA_PATH=/etc/cgm/certs/AmazonRootCA1.pem

# Camera config — enable RTSP in Tapo app: Camera Settings → Advanced → On Device Streaming
CAM0_NAME=front-gate
CAM0_IP=192.168.1.100
CAM0_USER=admin
CAM0_PASS=your-rtsp-password

# Add CAM1_NAME, CAM1_IP etc. for additional cameras

# TTLock (from developer.ttlock.com)
TTLOCK_CLIENT_ID=your-client-id
TTLOCK_ACCESS_TOKEN=your-access-token
EOF
sudo chmod 600 /etc/cgm/cgm.env && sudo chown cgm:cgm /etc/cgm/cgm.env
```

**On the Pi — install packages:**

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg inotify-tools python3-pip
pip3 install requests --break-system-packages
```

**On the Pi — create the camera streaming script `/opt/cgm/stream.sh`:**

```bash
sudo mkdir -p /opt/cgm
sudo tee /opt/cgm/stream.sh > /dev/null << 'EOF'
#!/usr/bin/env bash
# Usage: stream.sh <name> <ip> <user> <pass>
set -euo pipefail
source /etc/cgm/cgm.env
NAME=$1 IP=$2 USER=$3 PASS=$4
HLS_DIR="/tmp/cgm/live/$NAME"
CLIP_DIR="/tmp/cgm/clips/$NAME"
mkdir -p "$HLS_DIR" "$CLIP_DIR"

get_creds() {
  C=$(curl -fsSL --cert "$CERT_PATH" --key "$KEY_PATH" --cacert "$CA_PATH" \
    "https://$IOT_CRED_ENDPOINT/role-aliases/$IOT_ROLE_ALIAS/credentials")
  export AWS_ACCESS_KEY_ID=$(echo "$C"   | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials']['accessKeyId'])")
  export AWS_SECRET_ACCESS_KEY=$(echo "$C" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials']['secretAccessKey'])")
  export AWS_SESSION_TOKEN=$(echo "$C"   | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials']['sessionToken'])")
}

# Upload HLS segments as they are written (for live view)
upload_live() {
  while inotifywait -qq -e close_write,moved_to "$HLS_DIR"; do
    get_creds
    aws s3 sync "$HLS_DIR/" "s3://$VIDEO_BUCKET/live/$NAME/" \
      --delete --cache-control "max-age=2" --region "$AWS_REGION" --no-progress 2>/dev/null || true
  done
}

# Upload completed 5-min clips
upload_clips() {
  while inotifywait -qq -e close_write "$CLIP_DIR" --include '\.mp4$'; do
    sleep 2
    for f in "$CLIP_DIR"/*.mp4; do
      [ -f "$f" ] || continue
      D=$(date -r "$f" +"%Y/%m/%d") T=$(date -r "$f" +"%H-%M-%S")
      get_creds
      aws s3 cp "$f" "s3://$VIDEO_BUCKET/clips/$NAME/$D/$T.mp4" \
        --region "$AWS_REGION" --no-progress && rm -f "$f"
    done
  done
}

get_creds
upload_live &
upload_clips &

ffmpeg -hide_banner -loglevel warning \
  -rtsp_transport tcp -i "rtsp://$USER:$PASS@$IP:554/stream1" \
  -map 0:v:0 -map 0:a? -c:v copy -c:a aac -b:a 64k \
  -f hls -hls_time 10 -hls_list_size 5 \
  -hls_flags delete_segments+append_list+independent_segments \
  -hls_segment_filename "$HLS_DIR/%03d.ts" "$HLS_DIR/stream.m3u8" \
  -map 0:v:0 -map 0:a? -c:v copy -c:a aac -b:a 64k \
  -f segment -segment_time 300 -segment_format mp4 \
  -strftime 1 -reset_timestamps 1 "$CLIP_DIR/%Y%m%d_%H%M%S.mp4"
EOF
sudo chmod +x /opt/cgm/stream.sh && sudo chown cgm:cgm /opt/cgm/stream.sh
```

Note- If you only want to send clips where motion is detected then consider appending this pararmeter below to the ffmpeg command
-vf "select='gt(scene,<float e.g. 0.05>)'" \

Note- If you want to monitor for motion only in a part of the area consider appending this parameter below to the ffmpeg cmd, after adjusting your coordinates.
-vf "crop=500:500:100:100,select='gt(scene,0.05)'" \
  -map 0:v:0 -map 0:a? -c:v libx264 -preset ultrafast \

Both the above modifications will put more stress on ffmpeg running on pi so keep that in mind.


**On the Pi — create systemd service `/etc/systemd/system/cgm-camera@.service`:**

```bash
sudo tee /etc/systemd/system/cgm-camera@.service > /dev/null << 'EOF'
[Unit]
Description=CGM camera %i
After=network-online.target

[Service]
User=cgm
EnvironmentFile=/etc/cgm/cgm.env
ExecStartPre=/bin/bash -c 'mkdir -p /tmp/cgm/live/%i /tmp/cgm/clips/%i'
ExecStart=/bin/bash -c 'source /etc/cgm/cgm.env; \
  IDX=0; \
  for i in 0 1 2 3 4; do \
    eval "_N=\${CAM${i}_NAME:-}"; \
    [ "$_N" = "%i" ] && IDX=$i && break; \
  done; \
  eval N=\$CAM${IDX}_NAME I=\$CAM${IDX}_IP U=\$CAM${IDX}_USER P=\$CAM${IDX}_PASS; \
  exec /opt/cgm/stream.sh "$N" "$I" "$U" "$P"'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cgm-camera@front-gate

# Check it's running
sudo systemctl status cgm-camera@front-gate
journalctl -u cgm-camera@front-gate -f
```

---

## 6. TTLock webhook

1. Go to [TTLock Developer Portal](https://open.ttlock.com) → your app
2. Set webhook URL to the `WebhookURL` from SAM outputs
3. Signing secret must match `TTLockClientSecret` in `samconfig.toml`

---

## Updating thresholds (no redeploy)

```bash
# Change to 3 failed attempts before SMS fires
aws ssm put-parameter --name "/cgm/threshold"     --value "3" --overwrite

# Change to 30-minute rolling window
aws ssm put-parameter --name "/cgm/window-minutes" --value "30" --overwrite
```

---

## Redeploying after code changes

```bash
sam build && sam deploy

# Rebuild and re-upload dashboard if frontend changed
cd dashboard && npm run build && cd ..
aws s3 sync dist/ "s3://$BUCKET/" --delete \
  --cache-control "public,max-age=31536000,immutable" --exclude "index.html"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate"
```

---

## Project structure

```
cloud-gate-monitor/
├── template.yaml                   # All AWS infrastructure
├── samconfig.toml                  # Deploy config — edit before first deploy
├── functions/
│   ├── ttlock-webhook/index.ts     # Webhook handler + SMS alert
│   ├── clip-api/index.ts           # S3 clip list + presigned URLs
│   └── events-api/index.ts         # DynamoDB events query
└── dashboard/
    └── src/
        ├── App.tsx                 # Auth routing
        ├── auth.ts                 # Cognito PKCE (no Amplify)
        ├── api.ts                  # API client
        └── components/
            ├── Dashboard.tsx       # Shell + tabs
            ├── HlsPlayer.tsx       # Live stream (hls.js)
            ├── EventFeed.tsx       # Lock event timeline
            └── ClipBrowser.tsx     # Clip grid + inline player
```

---
