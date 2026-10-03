from pathlib import Path
import secrets
r=Path('.')
p=r/'.env'
if not p.exists():p.write_text((r/'.env.example').read_text().replace('CREDENTIAL_ENCRYPTION_KEY=','CREDENTIAL_ENCRYPTION_KEY='+secrets.token_hex(32)).replace('SESSION_SECRET=','SESSION_SECRET='+secrets.token_hex(32)))
p=r/'packages/core/src/tools/finish.ts';p.write_text(p.read_text().replace('(args,ctx)','(args,_ctx)'))
