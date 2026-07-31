# AURA — Autonomous University Resource Allocator

**Green Cloud Resource Optimization for Smart University Data Centers**

BCSE355L — Cloud Architecture Design
Course Instructor: Dr. Priya V

---

## Team Members

24BIT0539 Agrani Anupam  
24BIT0548 Prakul Jain  
24BIT0537 Pranav Hasban

---

## Problem Statement

University data centers handle highly variable workloads (LMS traffic, research computing, IoT/campus systems) but generally run on static, over-provisioned infrastructure, wasting energy during periods of low demand. Current green cloud computing research is generic to enterprise/IoT contexts and overlooks the predictable, cyclical nature of demand in academic environments (e.g. semester start, exam weeks, breaks). AURA aims to fill this gap by applying AI-driven resource optimization specifically tuned to university workload patterns, using AWS cloud services.

---

## Objectives

1. Develop an AI-driven resource allocation framework for workloads at university data centers.
2. Reduce energy consumption and carbon footprint of university cloud infrastructure using AWS services.
3. Predict academic-calendar-driven demand cycles (semester start, exam weeks, breaks) to enable proactive scaling.
4. Implement carbon-intensity-aware task scheduling for sustainable resource use.
5. Provide real-time monitoring and visualization of energy/cost savings via dashboards.
6. Ensure scalability and SLA compliance while optimizing for sustainability.

---

## Technology Stack

**Cloud Services (AWS):** EC2, S3, Lambda, SageMaker, CloudWatch, SNS, API Gateway

**Backend:** Node.js, Express

**Frontend:** React

**Database:** Amazon DynamoDB

**ML / AI:** Python, TensorFlow

**Other tools:** Git, GitHub, Docker, Jupyter Notebook, Postman

---

## Dataset Details

- **Dataset Name:** Azure Public Dataset V2 (VM CPU Utilization Traces, 2019)
- **Source:** Microsoft Azure (official research release)
- **URL:** https://github.com/Azure/AzurePublicDataset/blob/master/AzurePublicDatasetV2.md
- **Size:** 235GB
- **Number of Records:** Approx 2.6 million VMs and about 1.9 billion utilization readings
- **Number of Features:** Core fields include 5-minute VM CPU utilization readings, plus a VM information table and a subscription table (with some fields encrypted/anonymized), roughly 6-8 usable columns once the CSV (timestamp, VM ID, CPU avg/max, VM category, core count, memory) is inspected.
- **Data Type:** Time-series, tabular (CSV)
- **License:** Released by Microsoft specifically for the benefit of the research and academic community.
- **Purpose of use:** Training the demand-forecasting component of AURA to learn VM resource utilization patterns to predict future demand and enable proactive, energy-aware scheduling decisions.
- **Preprocessing required:** Downsampling to a manageable subset, resampling to consistent time intervals, normalizing CPU utilization values, handling anonymized/encrypted metadata fields, filtering to relevant columns only.

---

## Repository Structure

```
AURA_Cloud_Project_2026/
├── README.md
├── LICENSE
├── .gitignore
├── docs/
├── architecture/
├── dataset/
├── src/
│   ├── frontend/
│   ├── backend/
│   ├── ml_model/
│   └── aws/
├── results/
└── presentation/
```