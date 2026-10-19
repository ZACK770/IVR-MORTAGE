# ����� ����� �?Cloudflare Workers

����� ����� Module API ���� ������� ���. �������� ������ ������ �����;
�?Worker ����� JSON ����� ����� ����. ��� ���� ���� ����� ����, ��� ������ �� ����� ������.

## ��� ������ - ���� ���

1. ������ ����� Cloudflare ������� Workers & Pages.
2. ������ Worker ������ Workers Free.
3. ������ �� ���� ���� �������� �� �� dist/worker.js ����� ���� �������.
4. ������� Variables and Secrets ������� Secret ��� IVR_PATH_SECRET.
   ���� ���� ����� ����� 24 ����� ������� ������� ��������, �����, �� ����� �� ���.
5. ������ �� �����.
6. ������ ������ /healthz ����� {"status":"ok"}.
7. ������� ��������� �� ������ ����, �� ���� ������ ��������:
   https://ivr-mortage.<your-subdomain>.workers.dev/ivr/<IVR_PATH_SECRET>
8. ������� paramsMode=chain ������ ������� ���� ������.

��� ���� ����� ������. ����� workers.dev ����� ������.
��� ������ Cloudflare Access �� ��� ������� �� ����� �����: �������� ����� ����� ���� �?GET.

## ��� GitHub �� CLI

wrangler.json ����� �?src/worker.js. ������ ����� Git �?Cloudflare �������
������ ����� npx wrangler deploy, �������� �� ���� ������ �?Worker.

���� �� ����� �� ����� Cloudflare �����:

```sh
npx wrangler login
npx wrangler secret put IVR_PATH_SECRET
npx wrangler deploy
```

## ������

```sh
node --test test/worker.test.js
npm run build:worker
```

������� ������� �� �?Worker �� Request �?Response ������, ��� ����� ���.
�� ���� ����� ������ ���� ������ �� ������ ����� Cloudflare ���� �����.

## ����

��� ������ ����� ����� �?19 �������� 2026, Workers Free ����
100,000 ����� ���� ��� 10 ��������� CPU �����.
������ ��� �� ���� ��� ��� ����� ����� ���� (�����, ��� ����� ������, ����� ������).
��� 100,000 ����� �� �� �?20,000 ����� ������, ���� ������, ������ ������� ���� ������.
����� ��� ���� ������. ��� ����� ������ ������ �� SLA ������ �����.

https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/workers/reference/how-workers-works/
