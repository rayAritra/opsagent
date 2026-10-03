UPDATE platform.ai_employees SET policies=policies || '{"allowedEmailDomains":["acme.test"]}'::jsonb WHERE id='00000000-0000-4000-8000-000000000002' AND NOT policies ? 'allowedEmailDomains';
UPDATE platform.ai_employees SET model='claude-sonnet-5-5' WHERE id='00000000-0000-4000-8000-000000000002' AND model='claude-sonnet-4-6';
