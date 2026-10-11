"""Exact ordered equivalence to the original physical-keypoint duplicate scan."""
from types import SimpleNamespace
import unittest
import numpy as np
import overlap


def original(matches, a, b):
    retained=[]
    for i,j,r in matches:
        p,q=np.array(a['kp'][i].pt),np.array(b['kp'][j].pt)
        if any(np.linalg.norm(p-x[3])<3 or np.linalg.norm(q-x[4])<3 for x in retained): continue
        retained.append((i,j,r,p,q))
    return retained


def inputs(p,q):
    return ({'kp':[SimpleNamespace(pt=tuple(x)) for x in p]},
            {'kp':[SimpleNamespace(pt=tuple(x)) for x in q]})


class NeighborDedupTests(unittest.TestCase):
    def check_same(self,p,q,order=None):
        a,b=inputs(p,q)
        matches=[(i,i,float(n%7)/10) for n,i in enumerate(range(len(p)) if order is None else order)]
        expected=original(matches,a,b);actual=overlap.unique_matches(matches,a,b)
        self.assertEqual([x[:3] for x in actual],[x[:3] for x in expected])
        for x,y in zip(actual,expected):
            np.testing.assert_array_equal(x[3],y[3]);np.testing.assert_array_equal(x[4],y[4])
        return [x[0] for x in actual]

    def test_random_points_and_match_order(self):
        for seed in range(5):
            rng=np.random.default_rng(seed);p=rng.uniform(-80,80,(160,2));q=rng.uniform(-80,80,(160,2))
            with self.subTest(seed=seed):self.check_same(p,q,rng.permutation(len(p)))

    def test_clustered_points(self):
        rng=np.random.default_rng(10);centers=rng.uniform(-30,30,(6,2))
        p=centers[np.arange(240)%6]+rng.normal(0,1.4,(240,2))
        q=centers[np.arange(240)%6]+rng.normal(0,1.4,(240,2))
        self.check_same(p,q,rng.permutation(len(p)))

    def test_negative_coordinates_and_cell_borders(self):
        p=np.array([[-6.1,-3.1],[-5.9,-2.9],[-3.01,-.01],[-2.99,.01],[-.01,2.99],[.01,3.01],[-12,-12],[-9,-12]])
        q=np.arange(len(p)*2).reshape(-1,2)*10
        self.check_same(p,q)

    def test_exact_radius_is_retained_and_just_inside_is_not(self):
        for delta,expected in [(3.0,[0,1]),(np.nextafter(3.0,0),[0]),(np.nextafter(3.0,np.inf),[0,1])]:
            with self.subTest(delta=delta):
                self.assertEqual(self.check_same([[0,0],[delta,0]],[[0,0],[100,100]]),expected)

    def test_adjacent_diagonal_cell_and_euclidean_predicate(self):
        self.assertEqual(self.check_same([[2.9,2.9],[3.1,3.1]],[[0,0],[100,100]]),[0])
        self.assertEqual(self.check_same([[0,0],[2.2,2.2]],[[0,0],[100,100]]),[0,1])

    def test_duplicate_on_either_side(self):
        far=[[0,0],[10,10],[20,20],[30,30]];near=[[0,0],[1,0],[10,10],[11,10]]
        self.assertEqual(self.check_same(near,far),[0,2])
        self.assertEqual(self.check_same(far,near),[0,2])

    def test_rejected_point_does_not_enter_buckets(self):
        self.assertEqual(self.check_same([[0,0],[1,0],[4,0]],[[0,0],[100,0],[101,0]]),[0,2])

    def test_empty_and_same_location_orientations(self):
        self.assertEqual(self.check_same([],[]),[])
        self.assertEqual(self.check_same([[0,0]]*4,[[0,0]]*4,[3,1,2,0]),[3])

if __name__=='__main__':unittest.main()
