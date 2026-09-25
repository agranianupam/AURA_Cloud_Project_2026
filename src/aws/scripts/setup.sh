#!/usr/bin/env bash
# AURA — AWS resource provisioning (Free Tier only).
# Requires: aws-cli v2, configured credentials (aws configure), zip.
#
# Usage: AWS_REGION=ap-south-1 ./setup.sh
#
# Idempotency: re-running skips resources that already exist by name.
# This does NOT set up billing alarms — do that once, manually, in the
# AWS console before running this (Billing > Budgets > zero-spend alarm).

set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
PROJECT="aura"
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/.env"

echo "== AURA AWS setup (region: $REGION) =="
echo "Writing resource IDs to $ENV_FILE"

append_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

touch "$ENV_FILE"

# ---- DynamoDB tables (on-demand billing, Always Free tier) ----
create_table() {
  local name="$1" pk="$2" pk_type="$3" sk="${4:-}" sk_type="${5:-}"
  if aws dynamodb describe-table --table-name "$name" --region "$REGION" >/dev/null 2>&1; then
    echo "DynamoDB table $name already exists, skipping."
    return
  fi
  local key_schema="AttributeName=${pk},KeyType=HASH"
  local attr_defs="AttributeName=${pk},AttributeType=${pk_type}"
  if [ -n "$sk" ]; then
    key_schema="$key_schema AttributeName=${sk},KeyType=RANGE"
    attr_defs="$attr_defs AttributeName=${sk},AttributeType=${sk_type}"
  fi
  echo "Creating DynamoDB table $name..."
  aws dynamodb create-table \
    --table-name "$name" \
    --billing-mode PAY_PER_REQUEST \
    --key-schema $key_schema \
    --attribute-definitions $attr_defs \
    --region "$REGION" >/dev/null
  aws dynamodb wait table-exists --table-name "$name" --region "$REGION"
}

create_table "ResourceUsage" "timestamp" "S"
create_table "Allocations" "resourceId" "S"
create_table "Alerts" "alertId" "S" "timestamp" "S"

append_env "DYNAMODB_TABLE_USAGE" "ResourceUsage"
append_env "DYNAMODB_TABLE_ALLOCATIONS" "Allocations"
append_env "DYNAMODB_TABLE_ALERTS" "Alerts"

# ---- Cognito User Pool + App Client (Always Free up to 50K MAU) ----
POOL_NAME="${PROJECT}-user-pool"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='${POOL_NAME}'].Id | [0]" --output text)

if [ "$POOL_ID" == "None" ] || [ -z "$POOL_ID" ]; then
  echo "Creating Cognito user pool..."
  POOL_ID=$(aws cognito-idp create-user-pool \
    --pool-name "$POOL_NAME" \
    --auto-verified-attributes email \
    --region "$REGION" \
    --query 'UserPool.Id' --output text)
else
  echo "Cognito user pool $POOL_NAME already exists ($POOL_ID), skipping."
fi

CLIENT_NAME="${PROJECT}-app-client"
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --region "$REGION" \
  --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" --output text)

if [ "$CLIENT_ID" == "None" ] || [ -z "$CLIENT_ID" ]; then
  echo "Creating Cognito app client..."
  CLIENT_ID=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$POOL_ID" \
    --client-name "$CLIENT_NAME" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --region "$REGION" \
    --query 'UserPoolClient.ClientId' --output text)
else
  echo "Cognito app client $CLIENT_NAME already exists ($CLIENT_ID), skipping."
fi

append_env "COGNITO_USER_POOL_ID" "$POOL_ID"
append_env "COGNITO_APP_CLIENT_ID" "$CLIENT_ID"
append_env "COGNITO_REGION" "$REGION"
append_env "VITE_COGNITO_USER_POOL_ID" "$POOL_ID"
append_env "VITE_COGNITO_APP_CLIENT_ID" "$CLIENT_ID"
append_env "VITE_COGNITO_REGION" "$REGION"

# ---- SNS Topic (Always Free up to 1M publishes) ----
TOPIC_NAME="${PROJECT}-alerts"
TOPIC_ARN=$(aws sns list-topics --region "$REGION" \
  --query "Topics[?ends_with(TopicArn, ':${TOPIC_NAME}')].TopicArn | [0]" --output text)

if [ "$TOPIC_ARN" == "None" ] || [ -z "$TOPIC_ARN" ]; then
  echo "Creating SNS topic..."
  TOPIC_ARN=$(aws sns create-topic --name "$TOPIC_NAME" --region "$REGION" \
    --query 'TopicArn' --output text)
else
  echo "SNS topic $TOPIC_NAME already exists, skipping."
fi

append_env "SNS_TOPIC_ARN" "$TOPIC_ARN"

# ---- IAM role for Lambdas (least privilege) ----
ROLE_NAME="${PROJECT}-lambda-role"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "IAM role $ROLE_NAME already exists, skipping."
else
  echo "Creating IAM role $ROLE_NAME..."
  TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSNSFullAccess
  echo "Waiting for IAM role propagation..."
  sleep 10
fi

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

# ---- Deploy Lambda functions ----
deploy_lambda() {
  local fn_name="$1" src_dir="$2"
  local zip_path="/tmp/${fn_name}.zip"
  (cd "$src_dir" && zip -r -q "$zip_path" .)

  if aws lambda get-function --function-name "$fn_name" --region "$REGION" >/dev/null 2>&1; then
    echo "Updating Lambda $fn_name..."
    aws lambda update-function-code \
      --function-name "$fn_name" \
      --zip-file "fileb://${zip_path}" \
      --region "$REGION" >/dev/null
  else
    echo "Creating Lambda $fn_name..."
    aws lambda create-function \
      --function-name "$fn_name" \
      --runtime nodejs20.x \
      --role "$ROLE_ARN" \
      --handler index.handler \
      --zip-file "fileb://${zip_path}" \
      --timeout 10 \
      --region "$REGION" >/dev/null
  fi
  rm -f "$zip_path"
}

LAMBDA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lambda"
deploy_lambda "${PROJECT}-scaling-handler" "${LAMBDA_DIR}/scaling-handler"
deploy_lambda "${PROJECT}-alert-publisher" "${LAMBDA_DIR}/alert-publisher"

append_env "SCALING_LAMBDA_NAME" "${PROJECT}-scaling-handler"
append_env "ALERT_LAMBDA_NAME" "${PROJECT}-alert-publisher"
append_env "AWS_REGION" "$REGION"

echo ""
echo "== Done. Resource IDs written to $ENV_FILE =="
echo "Next: node src/backend/db/seed.js (after pulling mock data from feature/Agrani)"
