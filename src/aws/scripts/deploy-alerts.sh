#!/bin/bash
# Adds SNS email alerts, the alert-publisher Lambda on the AURA table stream, and CloudWatch alarms.
set -euo pipefail
export MSYS_NO_PATHCONV=1
AWS=${AWS:-aws}
PY=${PY:-python}
REGION=ap-south-1
INSTANCE=${INSTANCE:?set INSTANCE to the EC2 instance id}
EMAIL=${EMAIL:?set EMAIL for SNS alert emails}
SCRATCH="${TMPDIR:-/tmp}/aura-deploy"; mkdir -p "$SCRATCH"
ACCOUNT=$("$AWS" sts get-caller-identity --query Account --output text)

echo "== 1. DynamoDB stream on table AURA"
STREAM=$("$AWS" dynamodb describe-table --table-name AURA --query Table.LatestStreamArn --output text)
if [ "$STREAM" = "None" ]; then
  STREAM=$("$AWS" dynamodb update-table --table-name AURA --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE --query TableDescription.LatestStreamArn --output text)
  "$AWS" dynamodb wait table-exists --table-name AURA
fi
echo "stream $STREAM"

echo "== 2. SNS topic aura-alerts + email subscription"
TOPIC=$("$AWS" sns create-topic --name aura-alerts --query TopicArn --output text)
"$AWS" sns list-subscriptions-by-topic --topic-arn $TOPIC --query "Subscriptions[].Endpoint" --output text | grep -q "$EMAIL" || \
  "$AWS" sns subscribe --topic-arn $TOPIC --protocol email --notification-endpoint $EMAIL >/dev/null
echo "topic $TOPIC"

echo "== 3. IAM role for the Lambda"
if ! "$AWS" iam get-role --role-name aura-alert-lambda-role >/dev/null 2>&1; then
  "$AWS" iam create-role --role-name aura-alert-lambda-role --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  "$AWS" iam attach-role-policy --role-name aura-alert-lambda-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  "$AWS" iam put-role-policy --role-name aura-alert-lambda-role --policy-name aura-alert-access --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sns:Publish\",\"Resource\":\"$TOPIC\"},{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:DescribeStream\",\"dynamodb:GetRecords\",\"dynamodb:GetShardIterator\",\"dynamodb:ListStreams\"],\"Resource\":\"$STREAM\"}]}"
  sleep 15
fi
ROLE=arn:aws:iam::$ACCOUNT:role/aura-alert-lambda-role

echo "== 4. Lambda aura-alert-publisher"
"$PY" -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.write(sys.argv[2],'index.js'); z.close()" "$SCRATCH/alert-lambda.zip" "$(cygpath -m "$(dirname "$0")/../lambda/alert-stream-publisher/index.js" 2>/dev/null || echo "$(dirname "$0")/../lambda/alert-stream-publisher/index.js")"
if "$AWS" lambda get-function --function-name aura-alert-publisher >/dev/null 2>&1; then
  "$AWS" lambda update-function-code --function-name aura-alert-publisher --zip-file fileb://$SCRATCH/alert-lambda.zip >/dev/null
else
  "$AWS" lambda create-function --function-name aura-alert-publisher --runtime nodejs22.x --handler index.handler \
    --role $ROLE --timeout 30 --zip-file fileb://$SCRATCH/alert-lambda.zip \
    --environment "Variables={TOPIC_ARN=$TOPIC}" >/dev/null
fi
"$AWS" lambda wait function-active-v2 --function-name aura-alert-publisher
"$AWS" lambda list-event-source-mappings --function-name aura-alert-publisher --query "EventSourceMappings[0].UUID" --output text | grep -qv None || \
  "$AWS" lambda create-event-source-mapping --function-name aura-alert-publisher --event-source-arn $STREAM \
    --starting-position LATEST --batch-size 25 \
    --filter-criteria '{"Filters":[{"Pattern":"{\"eventName\":[\"INSERT\"],\"dynamodb\":{\"NewImage\":{\"type\":{\"S\":[\"alert\"]}}}}"}]}' >/dev/null

echo "== 5. CloudWatch alarms -> SNS"
"$AWS" cloudwatch put-metric-alarm --alarm-name aura-alert-publisher-errors --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=aura-alert-publisher --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC
"$AWS" cloudwatch put-metric-alarm --alarm-name aura-ec2-high-cpu --namespace AWS/EC2 --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=$INSTANCE --statistic Average --period 300 --evaluation-periods 3 \
  --threshold 80 --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC
"$AWS" cloudwatch put-metric-alarm --alarm-name aura-ec2-status-check --namespace AWS/EC2 --metric-name StatusCheckFailed \
  --dimensions Name=InstanceId,Value=$INSTANCE --statistic Maximum --period 60 --evaluation-periods 2 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC

echo "TOPIC=$TOPIC" >> "$SCRATCH/aura-aws-ids.txt"
echo
echo "DONE"
"$AWS" cloudwatch describe-alarms --alarm-name-prefix aura- --query "MetricAlarms[].[AlarmName,StateValue]" --output text
"$AWS" lambda list-event-source-mappings --function-name aura-alert-publisher --query "EventSourceMappings[0].State" --output text
