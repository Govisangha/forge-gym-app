import ForgeApp from '@/components/forge-app';
import {requireChatGPTUser} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Home(){const user=await requireChatGPTUser('/');return <ForgeApp userId={user.userId}/>}
