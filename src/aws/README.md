# src/aws/
AWS infrastructure for AURA as one CloudFormation stack: [`aura-stack.yaml`](aura-stack.yaml).

> **Status: untested on a real AWS account.** The template passes `cfn-lint`, but nobody has deployed it yet. Expect to fix small things on the first deploy.

## What it creates

| Resource | Purpose |
|---|---|
| DynamoDB table `AURA` (`type` partition key, `id` sort key, stream on) | Energy metrics, savings, allocations, alerts and forecast, one item per record |
| Cognito user pool + app client | Dashboard sign-in. Users are created by an admin; there is no self sign-up. |
| SNS topic `aura-alerts` + email subscription | Notifications to the facility manager |
| Lambda `aura-alert-publisher` on the table stream | Emails each new `warning`/`critical` alert item through SNS |
| CloudWatch alarm | Notifies the SNS topic if the alert Lambda errors |
| S3 bucket (static website) | Hosts the built React dashboard |
| EC2 instance (`t3.micro`, Amazon Linux 2023) + IAM role | Runs the Express API (`src/backend`) on port 3000 under systemd and reads DynamoDB through its role |

The model is trained offline (`src/ml_model`). Its simulated results are loaded into DynamoDB with the seed script below. Running the forecast and scheduler on a schedule (SageMaker endpoint + EventBridge-triggered Lambda) is not part of this stack yet.

## Deploy
Prerequisites:
- AWS CLI v2, configured with credentials (`aws configure`)
- Node 18+
- The repo pushed somewhere the instance can clone over HTTPS without credentials (a public GitHub repo), on a branch that contains `src/backend`

```bash
# 1. Deploy the stack (about 5 minutes)
aws cloudformation deploy --stack-name aura --template-file src/aws/aura-stack.yaml --capabilities CAPABILITY_IAM --parameter-overrides AlertEmail=you@example.com DashboardBucketName=aura-dashboard-<unique-suffix> BackendRepoUrl=https://github.com/<you>/AURA_Cloud_Project_2026.git BackendRepoBranch=main

# 2. Read the outputs: UserPoolId, UserPoolClientId, ApiUrl, DashboardUrl, TableName
aws cloudformation describe-stacks --stack-name aura --query "Stacks[0].Outputs" --output table
```

3. **Confirm the SNS subscription.** Click the link in the "AWS Notification - Subscription Confirmation" email. Alerts are not delivered until you do.

4. **Create a dashboard user:**
```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username you@example.com --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username you@example.com --password '<10+ chars, upper, lower, number>' --permanent
```

5. **Seed DynamoDB** with the simulation output (`results/simulation/*.json`). By default this writes the last 30 days of hourly metrics and only the 20 newest alerts. Every inserted alert triggers the alert Lambda, so the warning/critical ones among those 20 are emailed. Use `--alerts 0` to send none.
```bash
cd src/backend
npm ci
DYNAMODB_TABLE=AURA AWS_REGION=<region> npm run seed:dynamodb
# PowerShell: $env:DYNAMODB_TABLE="AURA"; $env:AWS_REGION="<region>"; npm run seed:dynamodb
```

6. **Check the API:**
```bash
curl http://<ApiUrl host>:3000/api/health
```
`/api/*` routes return 401 without a Cognito token, which is expected.

7. **Build and upload the dashboard.** Create `src/frontend/.env.production.local`:
```
VITE_USE_MOCK=false
VITE_API_BASE_URL=<ApiUrl>
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_CLIENT_ID=<UserPoolClientId>
```
Then:
```bash
cd src/frontend
npm ci
npm run build
aws s3 sync dist s3://<DashboardBucketName> --delete
```
Open the `DashboardUrl` output and sign in with the user from step 4.

## Tear down (do this when you're finished, to stop charges)
```bash
aws s3 rm s3://<DashboardBucketName> --recursive
aws cloudformation delete-stack --stack-name aura
```
The bucket must be empty before the stack can delete it.

## Limitations and production follow-ups
- **HTTP only.** The API is plain HTTP on port 3000 and the S3 website endpoint is HTTP. The dashboard can call the API only because both are HTTP: a page served over HTTPS cannot call an HTTP API (browsers block mixed content). For production:
  - put the dashboard behind **CloudFront** with an ACM certificate
  - put the API behind an **Application Load Balancer** with HTTPS, or move it to **API Gateway** + Lambda (the Express app can be wrapped)
  - restrict the security group to the load balancer
- **Public bucket.** The bucket is public-read because S3 website hosting needs it. If your account has *Block Public Access* enabled account-wide, the bucket policy step fails; use CloudFront with Origin Access Control instead.
- **Single instance.** No auto scaling or health checks for the API host. If you pass a `KeyName`, port 22 is open to the world; prefer SSM Session Manager, which the instance role already allows.
- **Lambda runtime.** The template uses `nodejs24.x`. If your region doesn't offer it yet, change it to `nodejs22.x`.
- **Cost.**
  - EC2 `t3.micro`: about $8/month, or free tier
  - DynamoDB on-demand, Lambda and SNS: cents at this volume
  - Point-in-time recovery on the table: a small extra charge
