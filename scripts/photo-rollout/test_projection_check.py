import copy
import math
import unittest
from accept import Rejected
from projection_check import check


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        # World x=right, y=forward, z=up; two depth planes and different heights.
        self.pose=dict(camera=[0,0,1],R=[[1,0,0],[0,0,-1],[0,1,0]],K=[[500,0,450],[0,500,600],[0,0,1]],image_size=[900,1200])
        self.plan=dict(outW=900,outH=1200,cx=1000,cy=1500,fs=500,fp=500,enginePitch=88,pose=dict(hfov=84,pitch=0,roll=0))
        pts=[[-1,5,0],[1,5,1],[1,10,4],[-1,10,0]];e=math.radians(-2)
        self.snapshot={'points':[]}
        for i,(x,y,z) in enumerate(pts):
            up=z-1;depth=up*math.sin(e)+y*math.cos(e)
            self.snapshot['points'].append(dict(name=str(i),xyz=[x,y,z],engine=dict(x=1000+500*x/depth,y=1500-500*(up*math.cos(e)-y*math.sin(e))/depth)))

    def test_cross_plane_roundtrip_and_shifted_camera_failure(self):
        self.assertLess(check(self.pose,self.plan,self.snapshot,.01)['max_error_px'],1e-10)
        wrong=copy.deepcopy(self.pose);wrong['camera'][1]=.27
        self.assertEqual(check(wrong,self.plan,self.snapshot,1)['status'],'REJECT')
        wrong=copy.deepcopy(self.plan);wrong['pose']['roll']=3
        self.assertEqual(check(self.pose,wrong,self.snapshot,1)['status'],'REJECT')

    def test_invalid_focal_or_pixel_cannot_pass(self):
        self.plan['fs']=0
        with self.assertRaises(Rejected):check(self.pose,self.plan,self.snapshot,1)
        self.plan['fs']=500;self.snapshot['points'][0]['engine']['x']=float('nan')
        with self.assertRaises(Rejected):check(self.pose,self.plan,self.snapshot,1)

    def test_single_plane_cannot_establish_cross_plane_agreement(self):
        for p in self.snapshot['points']:p['xyz'][1]=5
        with self.assertRaises(Rejected):check(self.pose,self.plan,self.snapshot,1)


if __name__=='__main__':unittest.main()
