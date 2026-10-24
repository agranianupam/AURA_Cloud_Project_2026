#!/bin/bash
# Adds DynamoDB, Cognito, an EC2 IAM role and S3 dashboard hosting to the running AURA demo.
set -euo pipefail
export MSYS_NO_PATHCONV=1
AWS=${AWS:-aws}
REGION=ap-south-1
INSTANCE=${INSTANCE:?set INSTANCE to the EC2 instance id}
IP=${IP:?set IP to the EC2 public IP}
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRATCH="${TMPDIR:-/tmp}/aura-deploy"; mkdir -p "$SCRATCH"
ACCOUNT=$("$AWS" sts get-caller-identity --query Account --output text)
BUCKET=aura-dashboard-$ACCOUNT
EMAIL=${EMAIL:?set EMAIL to the Cognito login email}
SSH="ssh -i $HOME/.ssh/aura-key.pem -o LogLevel=ERROR ec2-user@$IP"

echo "== 1. DynamoDB table AURA"
"$AWS" dynamodb describe-table --table-name AURA >/dev/null 2>&1 || \
  "$AWS" dynamodb create-table --table-name AURA --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=type,AttributeType=S AttributeName=id,AttributeType=S \
    --key-schema AttributeName=type,KeyType=HASH AttributeName=id,KeyType=RANGE >/dev/null
"$AWS" dynamodb wait table-exists --table-name AURA
(cd "$REPO/src/backend" && cp scripts/seed-dynamodb.js scripts/.seed-tmp.mjs && DYNAMODB_TABLE=AURA AWS_REGION=$REGION node scripts/.seed-tmp.mjs; rm -f scripts/.seed-tmp.mjs)

echo "== 2. IAM role so the server can read DynamoDB without keys"
if ! "$AWS" iam get-role --role-name aura-ec2-role >/dev/null 2>&1; then
  "$AWS" iam create-role --role-name aura-ec2-role --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  "$AWS" iam put-role-policy --role-name aura-ec2-role --policy-name aura-dynamodb-read --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:Query\",\"dynamodb:Scan\",\"dynamodb:BatchGetItem\",\"dynamodb:DescribeTable\"],\"Resource\":\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/AURA\"}]}"
  "$AWS" iam create-instance-profile --instance-profile-name aura-ec2-profile >/dev/null
  "$AWS" iam add-role-to-instance-profile --instance-profile-name aura-ec2-profile --role-name aura-ec2-role
  sleep 15
fi
"$AWS" ec2 describe-iam-instance-profile-associations --filters Name=instance-id,Values=$INSTANCE --query "IamInstanceProfileAssociations[0]" --output text | grep -q aura-ec2-profile || \
  "$AWS" ec2 associate-iam-instance-profile --instance-id $INSTANCE --iam-instance-profile Name=aura-ec2-profile >/dev/null

echo "== 3. Cognito user pool and your login"
POOL=$("$AWS" cognito-idp list-user-pools --max-results 50 --query "UserPools[?Name=='aura-users'].Id | [0]" --output text)
if [ "$POOL" = "None" ]; then
  POOL=$("$AWS" cognito-idp create-user-pool --pool-name aura-users --username-attributes email --auto-verified-attributes email \
    --admin-create-user-config AllowAdminCreateUserOnly=true \
    --policies 'PasswordPolicy={MinimumLength=10,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' \
    --query UserPool.Id --output text)
fi
CLIENT=$("$AWS" cognito-idp list-user-pool-clients --user-pool-id $POOL --query "UserPoolClients[?ClientName=='aura-dashboard'].ClientId | [0]" --output text)
if [ "$CLIENT" = "None" ]; then
  CLIENT=$("$AWS" cognito-idp create-user-pool-client --user-pool-id $POOL --client-name aura-dashboard --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH --prevent-user-existence-errors ENABLED \
    --query UserPoolClient.ClientId --output text)
fi
PASSWORD="Aura$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')Demo"
"$AWS" cognito-idp admin-get-user --user-pool-id $POOL --username $EMAIL >/dev/null 2>&1 || \
  "$AWS" cognito-idp admin-create-user --user-pool-id $POOL --username $EMAIL --message-action SUPPRESS \
    --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true >/dev/null
"$AWS" cognito-idp admin-set-user-password --user-pool-id $POOL --username $EMAIL --password "$PASSWORD" --permanent

echo "== 4. Switch the server to DynamoDB + Cognito"
$SSH "sudo mkdir -p /etc/systemd/system/aura.service.d && sudo tee /etc/systemd/system/aura.service.d/aws.conf >/dev/null <<EOF
[Service]
Environment=AUTH_DISABLED=false DYNAMODB_TABLE=AURA AWS_REGION=$REGION COGNITO_USER_POOL_ID=$POOL COGNITO_CLIENT_ID=$CLIENT CORS_ORIGIN=http://$BUCKET.s3-website.$REGION.amazonaws.com
EOF
sudo systemctl daemon-reload && sudo systemctl restart aura"

echo "== 5. S3 bucket hosting the dashboard"
"$AWS" s3api head-bucket --bucket $BUCKET 2>/dev/null || \
  "$AWS" s3api create-bucket --bucket $BUCKET --region $REGION --create-bucket-configuration LocationConstraint=$REGION >/dev/null
"$AWS" s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
"$AWS" s3api put-bucket-policy --bucket $BUCKET --policy \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$BUCKET/*\"}]}"
"$AWS" s3 website s3://$BUCKET --index-document index.html --error-document index.html
OUT="$SCRATCH/aura-dist-s3"
(cd "$REPO/src/frontend" && VITE_USE_MOCK=false VITE_AUTH_DISABLED=false VITE_API_BASE_URL=http://$IP \
  VITE_COGNITO_USER_POOL_ID=$POOL VITE_COGNITO_CLIENT_ID=$CLIENT npx vite build --mode aws --outDir "$OUT" --emptyOutDir >/dev/null)
"$AWS" s3 sync "$OUT" s3://$BUCKET --delete --only-show-errors

cat > "$SCRATCH/aura-aws-ids.txt" <<EOF
POOL=$POOL
CLIENT=$CLIENT
BUCKET=$BUCKET
EOF
echo
echo "DONE"
echo "Dashboard: http://$BUCKET.s3-website.$REGION.amazonaws.com"
echo "Login:     $EMAIL"
echo "Password:  $PASSWORD"
