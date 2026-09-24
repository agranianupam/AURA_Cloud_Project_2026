# AURA Frontend Dashboard

This directory contains the React (Vite) frontend for AURA — Autonomous University Resource Allocator.

## Quick Start

1. Install dependencies:
   \\\ash
   npm install
   \\\
2. Set up environment variables:
   Copy \.env.example\ to \.env\
   \\\ash
   cp .env.example .env
   \\\
   *(Note: Leave \VITE_USE_MOCK=true\ to use mock API data, or set it to \alse\ and provide \VITE_API_BASE_URL\ and Cognito credentials to consume live services).*
3. Start the dev server:
   \\\ash
   npm run dev
   \\\

## Build & Deploy to Amazon S3

1. **Build the production bundle:**
   \\\ash
   npm run build
   \\\
   Outputs to the \dist/\ directory.

2. **Deploy to an S3 Bucket (Static Website Hosting):**
   - Create an S3 bucket in your AWS account and enable "Static website hosting".
   - Set the \Index document\ to \index.html\.
   - Set the \Error document\ to \index.html\ (critical for React Router client-side routing).
   - Uncheck "Block all public access" and apply this fallback Bucket Policy (replace \YOUR_BUCKET_NAME\):
     \\\json
     {
       "Version": "2012-10-17",
       "Statement": [{
           "Sid": "PublicReadGetObject",
           "Effect": "Allow",
           "Principal": "*",
           "Action": "s3:GetObject",
           "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
       }]
     }
     \\\

3. **Upload the files:**
   Upload the exact contents of the \dist/\ directory (not the directory itself) to the root of your bucket.

4. **Navigate to your Bucket Website Endpoint URL!**
