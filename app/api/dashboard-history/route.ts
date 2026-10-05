import {getDashboard} from "@/app/lib/dashboard";
import {parseHistoryRequest,projectDashboardHistory,DashboardProjectionError} from "@/app/lib/dashboard-projection";
export async function GET(request:Request){
  try{const history=parseHistoryRequest(new URL(request.url));return Response.json(await projectDashboardHistory(await getDashboard(),history),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return Response.json({error:error instanceof DashboardProjectionError?error.message:"Detailed data is temporarily unavailable. Please retry."},{status:error instanceof DashboardProjectionError?error.status:503,headers:{"Cache-Control":"no-store"}});}
}
