import {NextResponse} from 'next/server';
import {z} from 'zod';
export async function GET(request:Request,{params}:{params:Promise<{system:string}>}){const system=z.enum(['portal','erp','mail']).parse((await params).system);const response=NextResponse.redirect(new URL('/'+system+'/login?expired=1',request.url));response.cookies.set('acme_'+system,'',{httpOnly:true,sameSite:'strict',path:'/'+system,maxAge:0});return response;}
