import React from 'react';
import Section, { PageHeader } from '../components/Section';

const SERVICES = [
  ['Amazon Cognito', 'Signs users in and issues the tokens the API checks.'],
  ['Amazon API Gateway', 'Public front door that routes dashboard requests to the backend.'],
  ['AWS Lambda', 'Runs the API and scheduled jobs without managing servers.'],
  ['Amazon DynamoDB', 'Stores metrics, allocations and alerts.'],
  ['Amazon SageMaker', 'Hosts the LSTM forecasting model that predicts demand.'],
  ['Amazon EC2', 'The compute fleet AURA scales up and down to follow demand.'],
  ['Amazon SNS', 'Sends notifications when alerts are raised.'],
  ['Amazon CloudWatch', 'Collects logs and metrics for monitoring AURA itself.'],
  ['AWS IAM', 'Grants each component only the permissions it needs.'],
];

export default function Architecture() {
  return (
    <>
      <PageHeader title="Architecture" subtitle="How AURA is built on AWS" />
      <Section about="Data flows from campus metrics into the forecasting model, then to the allocator, which acts on cloud resources and raises alerts shown in this dashboard.">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <img src="/architecture/AWS_Architecture.png" alt="AURA AWS architecture diagram" className="w-full h-auto" />
        </div>
      </Section>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="font-semibold text-gray-800 mb-3">AWS services used</h3>
        <ul className="divide-y divide-gray-100">
          {SERVICES.map(([name, role]) => (
            <li key={name} className="py-2 flex flex-col sm:flex-row sm:gap-4 text-sm">
              <span className="font-medium text-gray-900 sm:w-48 shrink-0">{name}</span>
              <span className="text-gray-600">{role}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

