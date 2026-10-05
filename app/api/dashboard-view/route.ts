import {getDashboard} from "@/app/lib/dashboard";
import {isDashboardView,projectDashboard,DashboardProjectionError} from "@/app/lib/dashboard-projection";
export async function GET(request:Request){
  const view=new URL(request.url).searchParams.get("section");
  if(!isDashboardView(view))return Response.json({error:"Unknown dashboard section."},{status:400,headers:{"Cache-Control":"no-store"}});
  try{return Response.json(await projectDashboard(await getDashboard(),view),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return Response.json({error:error instanceof DashboardProjectionError?error.message:"Validated dashboard data is temporarily unavailable."},{status:error instanceof DashboardProjectionError?error.status:503,headers:{"Cache-Control":"no-store"}});}
}
